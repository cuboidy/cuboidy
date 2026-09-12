import { describe, expect, it } from 'vitest';
import { AIR } from '../src/geometry/voxel-row.js';
import type { PaletteEntry, Part, Vec3Tuple } from '../src/geometry/types.js';
import { validateProject } from '../src/lint/cross-file.js';
import { buildMesh, type MeshData } from '../src/mesh.js';
import { parseManifest, type Manifest } from '../src/manifest.js';
import { openPlanesFor, type OpenPlane, type RestPlacement } from '../src/open-boundary.js';
import { resolveProject } from '../src/project.js';
import { buildSceneFromParts } from '../src/render/scene.js';
import { computeRestWorldTransforms, pivotRotsOf, QUAT_IDENTITY, type WorldTransform } from '../src/rig-transform.js';
import { rgba } from './helpers/palette.js';

const PALETTE: readonly PaletteEntry[] = [rgba(255, 0, 0, 255)];

// A 2-wide, 3-deep slab with the middle Z layer knocked out. The hole is what
// makes the interesting case reachable: the voxels at z=0 have an EXPOSED +z
// face at z=1, which is a `+z` face that is not on the boundary and must
// survive. Without the hole every interior +z face is culled by its
// neighbour anyway and the test could not tell the two rules apart.
function slab(): Part {
  const solid = [1, 1];
  const air = [AIR, AIR];
  return {
    name: 'slab',
    size: { w: 2, h: 1, d: 3 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [[solid, air, solid]],
  };
}

const AT_ORIGIN: WorldTransform = { pos: [0, 0, 0], quat: QUAT_IDENTITY };

interface Quad {
  normal: [number, number, number];
  corners: Vec3Tuple[];
}

// buildMesh emits four consecutive vertices per face, sharing one normal.
function quadsOf(mesh: MeshData): Quad[] {
  const out: Quad[] = [];
  for (let q = 0; q * 12 < mesh.positions.length; q++) {
    const corners: Vec3Tuple[] = [];
    for (let c = 0; c < 4; c++) {
      const at = q * 12 + c * 3;
      corners.push([mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!]);
    }
    out.push({
      normal: [mesh.normals[q * 12]!, mesh.normals[q * 12 + 1]!, mesh.normals[q * 12 + 2]!],
      corners,
    });
  }
  return out;
}

function facing(quads: readonly Quad[], normal: readonly number[]): Quad[] {
  return quads.filter(
    (q) => q.normal[0] === normal[0] && q.normal[1] === normal[1] && q.normal[2] === normal[2],
  );
}

const PLUS_Z_AT_3: OpenPlane = { face: '+z', axis: 2, positive: true, at: 3 };

describe('buildMesh — open boundaries (§6.14)', () => {
  it('omits the +z faces on the plane and keeps the interior one', () => {
    const part = slab();
    const closed = quadsOf(buildMesh(part, PALETTE));
    const open = quadsOf(
      buildMesh(part, PALETTE, { planes: [PLUS_Z_AT_3], transform: AT_ORIGIN }),
    );

    // Two voxels lose their +z face; nothing else changes.
    expect(closed).toHaveLength(20);
    expect(open).toHaveLength(18);

    const plusZ = facing(open, [0, 0, 1]);
    expect(plusZ).toHaveLength(2);
    // The survivors are the INTERIOR +z faces, at the hole (z = 1), not the
    // ones that were on the boundary plane (z = 3).
    for (const q of plusZ) {
      for (const c of q.corners) expect(c[2]).toBe(1);
    }
    expect(facing(closed, [0, 0, 1])).toHaveLength(4);
  });

  it('leaves every other plane intact', () => {
    const part = slab();
    const open = quadsOf(
      buildMesh(part, PALETTE, { planes: [PLUS_Z_AT_3], transform: AT_ORIGIN }),
    );
    const closed = quadsOf(buildMesh(part, PALETTE));
    for (const n of [[-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1]]) {
      expect(facing(open, n)).toHaveLength(facing(closed, n).length);
    }
    // The four −z faces sit at z = 0 and z = 2 and are untouched: the
    // declaration names one plane, not an axis.
    expect(facing(open, [0, 0, -1])).toHaveLength(4);
  });

  it('keeps the faces of a part that does not reach the plane', () => {
    // The same slab with the plane one voxel beyond it. Nothing lies on it,
    // so nothing is dropped — the test is equality, not proximity.
    const part = slab();
    const open = buildMesh(part, PALETTE, {
      planes: [{ face: '+z', axis: 2, positive: true, at: 4 }],
      transform: AT_ORIGIN,
    });
    expect(quadsOf(open)).toHaveLength(20);
  });

  it('keeps a −z face that lies on a +z plane', () => {
    // A face ON the plane but pointing back into the package is the inside of
    // a hollow, not a seam: the neighbouring package never covers it.
    const part = slab();
    const open = quadsOf(
      buildMesh(part, PALETTE, {
        planes: [{ face: '-z', axis: 2, positive: false, at: 0 }],
        transform: AT_ORIGIN,
      }),
    );
    expect(facing(open, [0, 0, -1])).toHaveLength(2); // the pair at z = 2 survives
    expect(facing(open, [0, 0, 1])).toHaveLength(4); // +z untouched
  });

  it('drops the same faces the renderer does', () => {
    // mesh.ts and render/scene.ts emit faces independently (the port is held
    // to the first, the CLIs render through the second), so the open-boundary
    // rule has to be the same rule in both or a snapshot and a bake disagree.
    const part = slab();
    const cull = { planes: [PLUS_Z_AT_3], transform: AT_ORIGIN };
    const mesh = quadsOf(buildMesh(part, PALETTE, cull));
    const scene = buildSceneFromParts(
      [{ part, remap: null, transform: AT_ORIGIN, open: [PLUS_Z_AT_3] }],
      PALETTE,
    );
    expect(scene.quads).toHaveLength(mesh.length);
    const key = (n: readonly number[], corners: readonly Vec3Tuple[]): string =>
      `${n.join(',')}|${[...corners].map((c) => c.join(',')).sort().join(' ')}`;
    expect(new Set(scene.quads.map((q) => key(q.normal, q.corners)))).toEqual(
      new Set(mesh.map((q) => key(q.normal, q.corners))),
    );
  });
});

function manifestOrThrow(json: unknown): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest parse failed: ${r.message}`);
  return r.value;
}

// The same slab twice, as an all-inline package: `head` at the origin and
// `foot` behind it, so the package's +z bound is `head`'s and `foot` is
// interior to it.
const TWO_PART = {
  name: 'bed',
  palette: ['#FF0000'],
  parts: [
    {
      name: 'head',
      // An explicit pivot at the corner, so the package's box is exactly the
      // voxels: the §7.7 default is bottom-CENTRE, which would put the bound
      // at a half coordinate and say nothing extra about the rule.
      geometry: {
        size: [2, 1, 3],
        pivot: { pos: [0, 0, 0] },
        voxels: [['00', '..', '00']],
      },
    },
    {
      name: 'foot',
      position: [0, 0, -3],
      geometry: {
        size: [2, 1, 3],
        pivot: { pos: [0, 0, 0] },
        voxels: [['00', '..', '00']],
      },
    },
  ],
};

function placementsOf(manifest: Manifest): Map<string, RestPlacement> {
  const project = resolveProject(manifest, new Map());
  const transforms = computeRestWorldTransforms(
    manifest.parts,
    pivotRotsOf(Array.from(project.parts, ([n, r]) => [n, r.part] as const)),
  );
  const out = new Map<string, RestPlacement>();
  for (const mp of manifest.parts) {
    out.set(mp.name, {
      part: project.parts.get(mp.name)!.part,
      transform: transforms.get(mp.name)!,
      scale: mp.scale,
    });
  }
  return out;
}

describe('openPlanesFor (§6.14)', () => {
  it('gives a manifest-level plane to every part, at the package bound', () => {
    const manifest = manifestOrThrow({ ...TWO_PART, openBoundaries: ['+z'] });
    const planes = openPlanesFor(manifest, placementsOf(manifest));
    expect(planes.get('head')).toEqual([PLUS_Z_AT_3]);
    // `foot` gets the plane too and simply has no face on it — which is what
    // makes a package-level declaration one statement rather than a list.
    expect(planes.get('foot')).toEqual([PLUS_Z_AT_3]);
  });

  it('gives a part-level plane to that part alone, at its own bound', () => {
    const manifest = manifestOrThrow({
      ...TWO_PART,
      parts: [
        TWO_PART.parts[0]!,
        { ...TWO_PART.parts[1]!, openBoundaries: ['-z'] },
      ],
    });
    const planes = openPlanesFor(manifest, placementsOf(manifest));
    expect(planes.has('head')).toBe(false);
    // `foot` sits at z ∈ [−3, 0]; its own −z bound is −3, not the package's.
    expect(planes.get('foot')).toEqual([{ face: '-z', axis: 2, positive: false, at: -3 }]);
  });

  it('is absent entirely when nothing declares one', () => {
    const manifest = manifestOrThrow(TWO_PART);
    expect(openPlanesFor(manifest, placementsOf(manifest)).size).toBe(0);
  });
});

describe('H05 — an animated part on an open boundary', () => {
  const lint = (manifest: Manifest) => {
    const project = resolveProject(manifest, new Map());
    return validateProject({
      manifest,
      geometries: project.geometries,
      parts: project.parts,
      unresolved: project.unresolved,
    });
  };

  const withClip = (target: string, extra: object) =>
    manifestOrThrow({
      ...TWO_PART,
      ...extra,
      animations: {
        open: {
          duration: 1,
          loop: false,
          parts: { [target]: { '0.0': { rot: [0, 0, 0] }, '1.0': { rot: [0, 40, 0] } } },
        },
      },
    });

  it('reports the part on the plane', () => {
    const diags = lint(withClip('head', { openBoundaries: ['+z'] }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.ruleId).toBe('H05');
    expect(diags[0]?.severity).toBe('hint');
    expect(diags[0]?.message).toContain("part 'head'");
    expect(diags[0]?.message).toContain('+z');
    expect(diags[0]?.message).toContain("'open'");
  });

  it('says nothing about an animated part that is not on the plane', () => {
    expect(lint(withClip('foot', { openBoundaries: ['+z'] }))).toEqual([]);
  });

  it('says nothing when no clip touches the part', () => {
    expect(lint(withClip('foot', { openBoundaries: ['+z'] }))).toEqual([]);
    expect(lint(manifestOrThrow({ ...TWO_PART, openBoundaries: ['+z'] }))).toEqual([]);
  });

  it('reports a part-level declaration on the part that carries it', () => {
    const diags = lint(
      withClip('foot', {
        parts: [
          TWO_PART.parts[0]!,
          { ...TWO_PART.parts[1]!, openBoundaries: ['-z'] },
        ],
      }),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.ruleId).toBe('H05');
    expect(diags[0]?.message).toContain("part 'foot'");
    expect(diags[0]?.message).toContain('-z');
  });
});
