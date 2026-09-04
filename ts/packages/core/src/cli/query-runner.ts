import { AIR, indexToChar } from '../geometry/voxel-row.js';
import {
  gridRotationWarnings,
  loadAndAssemble,
  parseCoordKey,
  stringifyCoord,
  type Assembly,
} from './assemble.js';
import { formatPaletteLine } from './palette-legend.js';
import { serializeColor } from '../geometry/palette.js';
import { sampleAnimation, type Pose } from '../animation.js';
import type { Vec3, Vec3Tuple } from '../geometry/types.js';
import {
  composeScale,
  computeWorldTransforms,
  localPointToWorld,
  pivotRotsOf,
  quatRotateVec3,
  type WorldTransform,
} from '../rig-transform.js';
import { publishedSocketFrames } from '../socket-frame.js';
import { round6 } from '../num.js';
import { buildMesh, type MeshData, type MeshMaterial } from '../mesh.js';

// cuboidy-query: structured, single-line coordinate lookup against an
// assembled model. Complement to cuboidy-view, designed for LLM
// consumption — the LLM names a coordinate and gets back one short
// line it can read without counting columns. Fractional coordinates
// are first-class (`--at=2.5,1,3` works exactly); the world grid is
// kept fractional throughout assembly (see assemble.ts).
//
// Two query forms:
//   --at=<x>,<y>,<z>
//   --core=<axis>,<pin1>=<v1>,<pin2>=<v2>
//
// Output shape (geometry-aligned):
//   at(3,4,5)=0                              palette-index char, `.` = AIR
//   core(y,x=3,z=4) y=0..4: 0.0.1            one-char-per-step string,
//                                            same alphabet as geometry voxel rows
//
// The core string uses a `step` chosen automatically: 1 when all
// voxels on the line sit at integer Y (or X / Z) positions, 0.5 when
// any voxel sits at a half-integer. The header annotates `step=0.5`
// in that case so the LLM can map character index to coordinate
// without ambiguity. Both range endpoints align to the step.

export type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

export interface AtQuery {
  kind: 'at';
  x: number;
  y: number;
  z: number;
}

export interface CoreQuery {
  kind: 'core';
  axis: Axis;
  // Two pin coordinates, one per non-iterating axis. We store an
  // ordered pair so the output preserves the user's spelling
  // (`x=3,z=4` not `z=4,x=3`).
  pin1: { axis: Axis; value: number };
  pin2: { axis: Axis; value: number };
}

// Every part's world transform and §6.5 pose, as numbers. The grid the two
// queries above read is an axis-aligned projection — a part's rest rotation
// moves its pivot but does not turn its cells — so rotation is very nearly
// invisible through it: dropping `pivot.rot` entirely, or composing
// q_pivot and q_rotation the wrong way round, does not move a single
// voxel in any shipped model. This prints the rig math itself, which is
// what makes those mistakes detectable across implementations.
export interface TransformsQuery {
  kind: 'transforms';
}

// Every frame the model publishes (§6.12), as numbers. `socket-frame.ts`
// is the join two packages meet at and no CLI printed it before.
export interface SocketsQuery {
  kind: 'sockets';
}

// The mesh, as the canonical SET SPEC §7.4 makes normative. Face ORDER is
// explicitly free — so that a mesher may merge or reorder faces without the
// format changing — which means a port cannot be checked by diffing index
// buffers. This prints the comparable form: one line per face, sorted, with
// a digest so two runs can be compared at a glance before anyone reads a
// thousand lines.
//
// Two things about a mesh are normative but are NOT visible in the face set:
// the material list's ORDER (§7.4 — `MeshGroup.material` indexes it) and the
// opaque/translucent split that decides the draw passes. Those get one
// `mesh-part` line each, so a port that emits the right rectangles with the
// materials in walk order still fails.
export interface MeshQuery {
  kind: 'mesh';
  // Print every face, not just the digest and the counts.
  faces: boolean;
}

/**
 * Which palette slot every cell of every part uses, and how much of it the
 * surface shows.
 *
 * This is the diff check for an edit. The geometry commands are colour-blind
 * -- lint is structural, cuboidy-clash only cares whether two colours DIFFER,
 * and cuboidy-overlap counts cells -- so a part refilled with the wrong index
 * passes all three and shows up as a band across the model. Census before an
 * edit, census after, and every line that moved should be one you meant to
 * move; an index appearing in a part that had none of it is the signature of
 * a mis-typed fill.
 */
export interface ColorsQuery {
  kind: 'colors';
}

export type Query =
  | AtQuery
  | CoreQuery
  | TransformsQuery
  | SocketsQuery
  | MeshQuery
  | ColorsQuery;

export interface QueryOptions {
  queries: readonly Query[];
  // SPEC §6.3 clip to sample, and the time in seconds to sample it at.
  // Applies to `transforms` and `sockets`; the voxel grid is rest-only
  // (see TransformsQuery) and says so rather than pretending otherwise.
  anim?: string | undefined;
  time?: number | undefined;
}

export interface RunResult {
  text: string;
  exitCode: 0 | 1 | 2;
}

export async function runQuery(
  dir: string,
  opts: QueryOptions,
): Promise<RunResult> {
  if (opts.queries.length === 0) {
    return fail(
      'no query specified (use --at=x,y,z, --core=axis,p1=v1,p2=v2, ' +
        '--transforms, --sockets, --mesh or --colors)',
      2,
    );
  }
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return fail(loaded.message, loaded.exitCode);
  }
  const asm = loaded.assembly;

  // Sampled poses, shared by every rig query in this invocation.
  let poses: ReadonlyMap<string, Pose> = new Map();
  const warnings: string[] = [];
  if (opts.anim !== undefined) {
    const clip = asm.animations.get(opts.anim);
    if (clip === undefined) {
      const known = [...asm.animations.keys()].sort().join(', ');
      return fail(
        `model has no animation "${opts.anim}"${known === '' ? '' : ` (has: ${known})`}`,
        2,
      );
    }
    poses = sampleAnimation(clip, opts.time ?? 0);
    if (opts.queries.some((q) => q.kind === 'at' || q.kind === 'core')) {
      warnings.push(
        '--at / --core read the rest-pose grid; --anim applies to --transforms, --sockets and --mesh',
      );
    }
  }

  // §7.7 world placement for every rig query in this invocation. Computed
  // once here rather than inside each formatter, so --transforms and --mesh
  // cannot disagree about where a part is: they are the same numbers.
  // `asm.resolvedParts[].transform` is the REST chain and stays that, since
  // the grid built from it is documented as rest-only.
  const world = computeWorldTransforms(
    asm.manifest.parts,
    pivotRotsOf(asm.resolvedParts.map((rp) => [rp.name, rp.part] as const)),
    poses,
  );

  const out: string[] = [];
  out.push(`model: ${asm.manifest.name}`);
  if (opts.anim !== undefined) {
    out.push(`anim: ${opts.anim} t=${num(opts.time ?? 0)}`);
  }
  out.push(formatBBox(asm));
  out.push(formatPaletteLine(asm.palette));
  out.push('');
  for (const q of opts.queries) {
    out.push(executeQuery(asm, q, poses, world));
  }
  for (const w of warnings) out.push(`warning: ${w}`);
  for (const w of asm.warnings) out.push(`warning: ${w}`);
  for (const w of gridRotationWarnings(asm)) out.push(`warning: ${w}`);

  return { text: out.join('\n'), exitCode: 0 };
}

function fail(message: string, exitCode: 1 | 2): RunResult {
  return { text: `cuboidy-query: ${message}\n`, exitCode };
}

function executeQuery(
  asm: Assembly,
  q: Query,
  poses: ReadonlyMap<string, Pose>,
  world: ReadonlyMap<string, WorldTransform>,
): string {
  if (q.kind === 'at') return executeAt(asm, q);
  if (q.kind === 'core') return executeCore(asm, q);
  if (q.kind === 'transforms') return formatTransforms(asm, poses, world);
  if (q.kind === 'mesh') return formatMesh(asm, q, poses, world);
  if (q.kind === 'colors') return formatColors(asm);
  return formatSockets(asm, poses);
}

// Cells and drawn faces, per part and per palette slot. Both, because they
// answer different halves of "did my edit paint what I meant": the cell count
// says what changed, and the face count says whether anyone can see it.
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function formatColors(asm: Assembly): string {
  const out: string[] = ['colors:'];
  const rows: Array<[string, string, string, number, number]> = [];
  for (const rp of asm.resolvedParts) {
    // `voxels` is already decoded to palette indices, with AIR for empty.
    const cells = new Map<number, number>();
    for (const layer of rp.part.voxels) {
      for (const row of layer) {
        for (const idx of row) {
          if (idx === AIR) continue;
          cells.set(idx, (cells.get(idx) ?? 0) + 1);
        }
      }
    }
    // Counted off the grid rather than read back out of `buildMesh`. The
    // mesh carries resolved RGB and no index, so attributing a face to a
    // palette slot through it means matching on colour — which merges two
    // slots that happen to hold the same colour, and misses a translucent
    // one outright, since alpha is not in the vertex colours. The cull rule
    // is one line anyway: a face is drawn where the neighbour is not solid.
    // Per part, exactly as `buildMesh(part, ...)` sees it — a cell hidden by
    // a DIFFERENT part still counts, because it is still this part's surface.
    const { w: sw, h: sh, d: sd } = rp.part.size;
    const solid = (x: number, y: number, z: number): boolean =>
      x >= 0 && y >= 0 && z >= 0 && x < sw && y < sh && z < sd &&
      (rp.part.voxels[y]?.[z]?.[x] ?? AIR) !== AIR;
    const faces = new Map<number, number>();
    for (let y = 0; y < sh; y++) {
      for (let z = 0; z < sd; z++) {
        for (let x = 0; x < sw; x++) {
          const idx = rp.part.voxels[y]?.[z]?.[x] ?? AIR;
          if (idx === AIR) continue;
          let open = 0;
          for (const [dx, dy, dz] of NEIGHBOURS) {
            if (!solid(x + dx, y + dy, z + dz)) open++;
          }
          faces.set(idx, (faces.get(idx) ?? 0) + open);
        }
      }
    }
    for (const idx of [...cells.keys()].sort((a, b) => a - b)) {
      const entry = rp.palette[idx];
      const hex = entry === undefined ? '(unbound)' : serializeColor(entry.color);
      rows.push([rp.name, indexToChar(idx), hex, cells.get(idx)!, faces.get(idx) ?? 0]);
    }
  }
  const w = Math.max(4, ...rows.map((r) => r[0].length));
  out.push(`  ${'part'.padEnd(w)}  idx  ${'hex'.padEnd(9)}   cells   faces`);
  for (const [part, ch, hex, cells, faces] of rows) {
    out.push(
      `  ${part.padEnd(w)}  ${ch.padEnd(3)}  ${hex.padEnd(9)}  ` +
        `${String(cells).padStart(6)}  ${String(faces).padStart(6)}`,
    );
  }
  out.push(
    `  total: ${rows.reduce((n, r) => n + r[3], 0)} cells in ` +
      `${asm.resolvedParts.length} parts`,
  );
  return out.join('\n');
}

// Every printed number goes through here: rounded to the 1e-6 grid the
// world coordinates already use, with -0 folded to 0 (JavaScript prints it
// as "0" and .NET as "-0"), and a fixed 6 decimals so the text form never
// switches to exponent notation. A parity harness should still compare
// parsed doubles with a tolerance rather than the strings.
function num(n: number): string {
  const r = round6(n);
  return (r === 0 ? 0 : r).toFixed(6);
}

// SPEC §7.4: only the SET of faces is normative, so the comparable form is
// sorted. Each line is one face — outward normal, four world corners in
// winding order, colour, alpha, material — and identical output means two
// implementations agree about the model's surfaces however they enumerated
// them.
//
// Built through `mesh.ts`, the module the C# side PORTS, and lifted into
// world space here with `localPointToWorld` — the §7.7 rule that is also
// ported. It used to run through `render/scene.ts`, which is dropped from
// the port and holds a second copy of the face table and the hide rule: a
// port diffed against that output was diffed against code it does not have,
// and every mesh.ts defect an audit tried (no culling, reversed winding, a
// flipped normal, the wrong magenta fallback) came through this query
// unchanged.
//
// Per-part palettes, not the merged one. `buildMesh(part, palette)` is the
// ported signature and `ResolvedPart.palette` is what a runtime holds; the
// merge exists so the ASCII grid can spell every colour with one character.
// Face lines carry colour VALUES, so both routes print the same thing.
function formatMesh(
  asm: Assembly,
  q: MeshQuery,
  poses: ReadonlyMap<string, Pose>,
  world: ReadonlyMap<string, WorldTransform>,
): string {
  const faces: string[] = [];
  const partLines: string[] = [];

  for (const rp of asm.resolvedParts) {
    const pose = poses.get(rp.name);
    // §6.5: an invisible part contributes no surface. Stated here because
    // the mesh is the only query where visibility has a consequence a port
    // can be measured against.
    if (pose !== undefined && !pose.visible) {
      partLines.push(`mesh-part ${rp.name} hidden`);
      continue;
    }
    const wt = world.get(rp.name);
    if (wt === undefined) continue;
    const mesh = buildMesh(rp.part, rp.palette);
    const piv: Vec3Tuple = [
      rp.part.pivot.pos.x,
      rp.part.pivot.pos.y,
      rp.part.pivot.pos.z,
    ];
    const scale = composeScale(rp.scale, pose?.scale);

    // buildMesh emits four consecutive vertices per face, in winding order,
    // sharing one normal / colour / alpha.
    const quadCount = mesh.positions.length / 12;
    const matOfQuad = quadMaterials(mesh, quadCount);
    let opaqueFaces = 0;
    for (let f = 0; f < quadCount; f++) {
      const corners: string[] = [];
      for (let c = 0; c < 4; c++) {
        const at = (f * 4 + c) * 3;
        const p = localPointToWorld(
          [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!],
          piv,
          scale,
          wt,
        );
        corners.push(p.map(num).join(','));
      }
      const n0 = f * 12;
      const n = quatRotateVec3(wt.quat, [
        mesh.normals[n0]!,
        mesh.normals[n0 + 1]!,
        mesh.normals[n0 + 2]!,
      ]);
      const m = mesh.materials[matOfQuad[f]!]!;
      if (!m.translucent) opaqueFaces++;
      faces.push(
        `face n=${n.map(num).join(',')} ${rotateToCanonicalStart(corners).join(' ')} ` +
          `rgb=${channels(mesh.colors, n0).join(',')} ` +
          `a=${channel(mesh.alphas[f * 4]!)} ` +
          `metallic=${num(m.metallic)} roughness=${num(m.roughness)} ` +
          `emissive=${num(m.emissive)}`,
      );
    }

    partLines.push(
      `mesh-part ${rp.name} faces=${quadCount} ` +
        `opaque-faces=${opaqueFaces} ` +
        `opaque-split=${opaqueSplitIsSound(mesh) ? 'ok' : 'BROKEN'} ` +
        `materials=${mesh.materials.map(materialWord).join(',') || '(none)'}`,
    );
  }

  // Ordinal, by UTF-16 code unit, which is what `Array.prototype.sort()` with
  // no comparator is specified to do. A port must say so explicitly:
  // .NET's default string comparer — including `OrderBy(x => x)` — is
  // culture-sensitive, and under ja-JP it reorders every line of this output.
  faces.sort();
  const out = [`mesh faces=${faces.length} digest=${digest(faces)}`];
  out.push(...partLines);
  if (q.faces) out.push(...faces);
  return out.join('\n');
}

// A colour channel, recovered to the 8-bit value it came from before being
// divided. `MeshData.colors` is a `Float32Array` because that is what a GPU
// takes, and printing it directly leaks the rounding: 182/255 is 0.713725 as
// a double and 0.713726 through float32, so a C# port computing `r / 255.0`
// — the obvious translation, and what §7.4 describes — failed two of the
// nine models on colour alone. The palette's channels are integers by
// definition (§7.4 hex), so the round trip is exact.
function channel(v: number): string {
  return num(Math.round(v * 255) / 255);
}

function channels(buf: ArrayLike<number>, at: number): string[] {
  return [channel(buf[at]!), channel(buf[at + 1]!), channel(buf[at + 2]!)];
}

// SPEC §7.4 makes the RECTANGLE normative, not where a face table starts
// listing it. Rotating the four corners to begin at the lexicographically
// smallest one keeps the cyclic order — so a reversed winding is still a
// different line — while letting a port whose table starts each quad at a
// different corner produce the same output. It emitted 612 differing lines
// before, for four identical rectangles with identical outward normals.
function rotateToCanonicalStart(corners: readonly string[]): string[] {
  let at = 0;
  for (let i = 1; i < corners.length; i++) {
    if (corners[i]! < corners[at]!) at = i;
  }
  return [...corners.slice(at), ...corners.slice(0, at)];
}

// SPEC §7.4's draw-pass split, expressed WITHOUT counting indices. The count
// itself is in index space, which the spec leaves free — a different
// triangulation moves it — but the property it exists for does not: every
// index below `opaqueIndexCount` belongs to an opaque material and every
// index above it to a translucent one.
function opaqueSplitIsSound(mesh: MeshData): boolean {
  for (const g of mesh.groups) {
    const translucent = mesh.materials[g.material]?.translucent ?? false;
    const end = g.start + g.count;
    const before = end <= mesh.opaqueIndexCount;
    const after = g.start >= mesh.opaqueIndexCount;
    // A group must sit wholly on one side, and on the side its material says.
    if (!before && !after) return false;
    if (before === translucent) return false;
  }
  return true;
}

// One material, in the ORDER SPEC §7.4 makes normative — which is the whole
// reason to print it: `MeshGroup.material` is an index into this list, so two
// implementations that order it differently hand the same face to different
// materials while both emitting the right rectangles.
function materialWord(m: MeshMaterial): string {
  return (
    `${num(m.metallic)}:${num(m.roughness)}:${num(m.emissive)}` +
    `:${m.translucent ? 't' : 'o'}`
  );
}

// Which material each quad is drawn with, read back through `groups` — the
// only route there is, and the one a renderer takes. A quad's four vertices
// are `4f .. 4f+3`, so any index into it names the quad.
function quadMaterials(
  mesh: { groups: readonly { start: number; count: number; material: number }[]; indices: ArrayLike<number> },
  quadCount: number,
): number[] {
  const out = new Array<number>(quadCount).fill(0);
  for (const g of mesh.groups) {
    for (let i = g.start; i < g.start + g.count; i++) {
      out[Math.floor(mesh.indices[i]! / 4)] = g.material;
    }
  }
  return out;
}

// FNV-1a over the sorted face lines, hex. Not cryptographic — a cheap
// "did these two runs agree" that fits on one line, so a parity harness
// can diff digests first and only print faces when they differ.
function digest(lines: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 10;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// A part's whole §6.5 pose, not just the rigid half. `scale` and `visible`
// are deliberately outside `WorldTransform` — scale is local and does not
// propagate to children, visibility is a draw decision — and that is exactly
// why they need printing: nothing else in the acceptance contract can see
// them. Measured before they were here, a port that never implemented
// `stepVisible`, or that applied scale in world axes after the rotation
// instead of about the pivot before it, produced byte-identical output for
// every model, every clip and every sample time.
//
// Both are printed for the rest pose too (`1,1,1` and `1`), so the line shape
// does not depend on whether `--anim` was given.
function formatTransforms(
  asm: Assembly,
  poses: ReadonlyMap<string, Pose>,
  world: ReadonlyMap<string, WorldTransform>,
): string {
  const lines: string[] = [];
  for (const mp of asm.order) {
    const wt = world.get(mp.name);
    if (wt === undefined) continue;
    const pose = poses.get(mp.name);
    const scale = composeScale(
      asm.manifest.parts.find((p) => p.name === mp.name)?.scale,
      pose?.scale,
    ) ?? [1, 1, 1];
    const visible = pose === undefined || pose.visible;
    lines.push(
      `transform ${mp.name} pos=${wt.pos.map(num).join(',')} ` +
        `quat=${wt.quat.map(num).join(',')} ` +
        `scale=${scale.map(num).join(',')} visible=${visible ? 1 : 0}`,
    );
  }
  return lines.join('\n');
}

function formatSockets(
  asm: Assembly,
  poses: ReadonlyMap<string, Pose>,
): string {
  const parts = new Map(
    asm.resolvedParts.map((rp) => [
      rp.name,
      { part: rp.part, palette: asm.palette, source: null },
    ]),
  );
  const frames = publishedSocketFrames(asm.manifest, parts, poses);
  const names = [...frames.keys()].sort();
  if (names.length === 0) return 'sockets: (model publishes none)';
  return names
    .map((n) => {
      const f = frames.get(n)!;
      return `socket ${n} pos=${f.pos.map(num).join(',')} quat=${f.quat.map(num).join(',')}`;
    })
    .join('\n');
}

function executeAt(asm: Assembly, q: AtQuery): string {
  const idx = asm.grid.get(stringifyCoord(q.x, q.y, q.z));
  const ch = idx === undefined ? '.' : indexToChar(idx);
  return `at(${fmt(q.x)},${fmt(q.y)},${fmt(q.z)})=${ch}`;
}

function executeCore(asm: Assembly, q: CoreQuery): string {
  // Collect every voxel whose pinned coords match the query. The two
  // pins must cover the two non-iterating axes; we trust the CLI
  // parser to have validated that.
  const matches = new Map<number, number>(); // coord-on-axis → palette index
  for (const [key, idx] of asm.grid) {
    const v = parseCoordKey(key);
    if (getAxis(v, q.pin1.axis) !== q.pin1.value) continue;
    if (getAxis(v, q.pin2.axis) !== q.pin2.value) continue;
    matches.set(getAxis(v, q.axis), idx);
  }

  // Step: 0.5 when any matched coord is non-integer, else 1.
  let step = 1;
  for (const c of matches.keys()) {
    if (!Number.isInteger(c)) {
      step = 0.5;
      break;
    }
  }

  // Iteration range: the model's bbox along the chosen axis, snapped
  // out to the step grid (floor for min, ceil for max). For step=1
  // these are integer ints; for step=0.5 they are half-integer.
  const rng = bboxRange(asm, q.axis, step);

  const cells: string[] = [];
  const n = Math.round((rng.max - rng.min) / step) + 1;
  for (let i = 0; i < n; i++) {
    const coord = rng.min + i * step;
    const hit = matches.get(coord);
    cells.push(hit === undefined || hit === AIR ? '.' : indexToChar(hit));
  }

  const head = `core(${q.axis},${q.pin1.axis}=${fmt(q.pin1.value)},${q.pin2.axis}=${fmt(q.pin2.value)})`;
  const range = `${q.axis}=${fmt(rng.min)}..${fmt(rng.max)}`;
  const stepNote = step === 1 ? '' : ` step=${step}`;
  return `${head} ${range}${stepNote}: ${cells.join('')}`;
}

function bboxRange(asm: Assembly, axis: Axis, step: number): { min: number; max: number } {
  const lo = axis === 'x' ? asm.bbox.minX : axis === 'y' ? asm.bbox.minY : asm.bbox.minZ;
  const hi = axis === 'x' ? asm.bbox.maxX : axis === 'y' ? asm.bbox.maxY : asm.bbox.maxZ;
  if (step === 1) {
    return { min: Math.floor(lo), max: Math.ceil(hi) };
  }
  // step = 0.5: snap to half-integer grid.
  return { min: Math.floor(lo * 2) / 2, max: Math.ceil(hi * 2) / 2 };
}

function getAxis(v: Vec3, axis: Axis): number {
  return axis === 'x' ? v.x : axis === 'y' ? v.y : v.z;
}

// --- CLI argument parsers (shared with cuboidy-query.ts) ------------------

// Parse `--at=x,y,z`. Empty / wrong arity → error message.
export function parseAtArg(raw: string): Query | { error: string } {
  const parts = raw.split(',');
  if (parts.length !== 3) {
    return { error: `--at expects 3 comma-separated numbers, got ${parts.length} ("${raw}")` };
  }
  const x = parseFloatStrict(parts[0]!);
  const y = parseFloatStrict(parts[1]!);
  const z = parseFloatStrict(parts[2]!);
  if (x === null) return { error: `--at: "${parts[0]}" is not a number` };
  if (y === null) return { error: `--at: "${parts[1]}" is not a number` };
  if (z === null) return { error: `--at: "${parts[2]}" is not a number` };
  return { kind: 'at', x, y, z };
}

// Parse `--core=<axis>,<pin1>=<v1>,<pin2>=<v2>`. Validates that the
// three axes mentioned form a permutation of {x, y, z}.
export function parseCoreArg(raw: string): Query | { error: string } {
  const parts = raw.split(',');
  if (parts.length !== 3) {
    return {
      error: `--core expects "<axis>,<pin1>=<v1>,<pin2>=<v2>", got "${raw}"`,
    };
  }
  const axis = parts[0]!.trim();
  if (!isAxis(axis)) {
    return { error: `--core: iteration axis must be x/y/z, got "${axis}"` };
  }
  const pin1 = parsePin(parts[1]!);
  if ('error' in pin1) return pin1;
  const pin2 = parsePin(parts[2]!);
  if ('error' in pin2) return pin2;

  // Pins must cover the two non-iterating axes, no duplicates.
  const used = new Set<Axis>([axis, pin1.axis, pin2.axis]);
  if (used.size !== 3) {
    return {
      error: `--core: iteration axis and two pin axes must be a permutation of {x, y, z}, got {${axis}, ${pin1.axis}, ${pin2.axis}}`,
    };
  }

  return { kind: 'core', axis, pin1, pin2 };
}

function parsePin(raw: string): { axis: Axis; value: number } | { error: string } {
  const eq = raw.indexOf('=');
  if (eq < 0) {
    return { error: `--core: pin "${raw}" missing "=" (expected <axis>=<value>)` };
  }
  const axis = raw.slice(0, eq).trim();
  if (!isAxis(axis)) {
    return { error: `--core: pin axis must be x/y/z, got "${axis}"` };
  }
  const valueRaw = raw.slice(eq + 1).trim();
  const value = parseFloatStrict(valueRaw);
  if (value === null) {
    return { error: `--core: pin value "${valueRaw}" is not a number` };
  }
  return { axis, value };
}

function isAxis(s: string): s is Axis {
  return (AXES as readonly string[]).includes(s);
}

function parseFloatStrict(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  // Forbid hex / Infinity / NaN: only finite decimal numbers.
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// --- formatters -----------------------------------------------------------

// Stringify a number canonically (matches assemble.ts stringifyCoord).
// For LLM consumption we drop trailing `.0` since `String(3)` is "3"
// not "3.0" — fractional coords retain their `.5` etc.
function fmt(n: number): string {
  return String(n);
}

function formatBBox(asm: Assembly): string {
  const b = asm.bbox;
  return (
    `bbox: ` +
    `X=${fmt(b.minX)}..${fmt(b.maxX)} ` +
    `Y=${fmt(b.minY)}..${fmt(b.maxY)} ` +
    `Z=${fmt(b.minZ)}..${fmt(b.maxZ)}` +
    (asm.hasFractional ? ' (contains half-voxel offsets)' : '')
  );
}

