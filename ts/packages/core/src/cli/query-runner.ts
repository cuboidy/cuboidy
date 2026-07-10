import type { Palette, Vec3 } from '../cvox/types.js';
import { AIR, indexToChar } from '../cvox/voxel-row.js';
import {
  loadAndAssemble,
  parseCoordKey,
  stringifyCoord,
  type Assembly,
} from './assemble.js';

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
// Output shape (cvox-aligned):
//   at(3,4,5)=0                              palette-index char, `.` = AIR
//   core(y,x=3,z=4) y=0..4: 0.0.1            one-char-per-step string,
//                                            same alphabet as cvox voxel rows
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

export type Query = AtQuery | CoreQuery;

export interface QueryOptions {
  queries: readonly Query[];
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
    return fail('no query specified (use --at=x,y,z or --core=axis,p1=v1,p2=v2)', 2);
  }
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return fail(loaded.message, loaded.exitCode);
  }
  const asm = loaded.assembly;

  const out: string[] = [];
  out.push(`model: ${asm.manifest.name}`);
  out.push(formatBBox(asm));
  out.push(formatPalette(asm.palette));
  out.push('');
  for (const q of opts.queries) {
    out.push(executeQuery(asm, q));
  }
  for (const w of asm.warnings) out.push(`warning: ${w}`);

  return { text: out.join('\n'), exitCode: 0 };
}

function fail(message: string, exitCode: 1 | 2): RunResult {
  return { text: `cuboidy-query: ${message}\n`, exitCode };
}

function executeQuery(asm: Assembly, q: Query): string {
  if (q.kind === 'at') return executeAt(asm, q);
  return executeCore(asm, q);
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

function formatPalette(palette: Palette): string {
  const entries: string[] = [];
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const hex =
      '#' +
      toHex(c.r) +
      toHex(c.g) +
      toHex(c.b) +
      (c.a === 255 ? '' : toHex(c.a));
    entries.push(`${indexToChar(i)}=${hex}`);
  }
  return `palette: ${entries.join(' ')}`;
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase();
}
