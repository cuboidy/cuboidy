import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/mesh.js';
import { buildSceneFromParts, type Quad } from '../src/render/scene.js';
import { QUAT_IDENTITY } from '../src/rig-transform.js';
import type { Palette, Part } from '../src/geometry/types.js';
import { rgba } from './helpers/palette.js';

// mesh.ts feeds the editor and the workspace; render/scene.ts feeds
// cuboidy-snap, cuboidy-view and cuboidy-gif. They implement the SAME SPEC
// §7.4 face-hiding rule twice, in two files, and nothing used to check that
// the two agreed.
//
// They did not. The translucent hide rule was fixed in mesh.ts and in
// scene.ts, and the editor kept drawing the old artifact for another day —
// because the editor loads core's hand-built `dist/`, and only the tests
// and the CLIs ran the source. A screenshot from the CLI and the same model
// in the editor were two different renderers AND two different vintages of
// the rule, so "I fixed it" and "it is not fixed" were both true.
//
// This test is the check that was missing: same part, same palette, same
// set of faces. It cannot catch a stale build (a vite alias handles that),
// but it does catch the two rules drifting apart again.

const A: Palette[number] = rgba(58, 160, 255, 0x66); // translucent
const B: Palette[number] = rgba(255, 106, 58, 0x66); // translucent
const O: Palette[number] = rgba(184, 190, 198, 255); // opaque
const PALETTE: Palette = [A, B, O];

// Voxels are indexed [y][z][x]; each case below is one row along x.
function rowPart(row: readonly number[]): Part {
  return {
    name: 'p',
    size: { w: row.length, h: 1, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [[[...row]]],
  };
}

// A face as a comparable string: normal, four corners in order, colour,
// alpha. Winding matters, so the corners are NOT sorted within a face.
function key(
  normal: readonly number[],
  corners: readonly (readonly number[])[],
  color: readonly number[],
  alpha: number,
): string {
  const n = normal.map((v) => v.toFixed(3)).join(',');
  const c = corners.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ');
  const rgb = color.map((v) => v.toFixed(4)).join(',');
  return `n[${n}] ${c} rgb[${rgb}] a${alpha.toFixed(4)}`;
}

function meshFaces(part: Part, palette: Palette): string[] {
  const m = buildMesh(part, palette);
  const out: string[] = [];
  // Each quad is six indices over four consecutive vertices; the index
  // buffer is reordered opaque-first, so walk it rather than the vertices.
  for (let i = 0; i < m.indices.length; i += 6) {
    const base = m.indices[i]!;
    const at = (v: number, arr: Float32Array, stride: number): number[] =>
      Array.from(arr.slice(v * stride, v * stride + stride));
    out.push(
      key(
        at(base, m.normals, 3),
        [0, 1, 2, 3].map((k) => at(base + k, m.positions, 3)),
        at(base, m.colors, 3),
        m.alphas[base]!,
      ),
    );
  }
  return out.sort();
}

function sceneFaces(part: Part, palette: Palette): string[] {
  const scene = buildSceneFromParts(
    [
      {
        part,
        remap: null,
        transform: { pos: [0, 0, 0], quat: QUAT_IDENTITY },
      },
    ],
    palette,
  );
  return scene.quads
    .map((q: Quad) => key(q.normal, q.corners, q.color, q.alpha))
    .sort();
}

describe('mesh.ts and render/scene.ts emit the same faces', () => {
  const cases: ReadonlyArray<readonly [string, readonly number[]]> = [
    ['a lone opaque voxel', [2]],
    ['a lone translucent voxel', [0]],
    ['two of ONE translucent colour', [0, 0]],
    ['two DIFFERENT translucent colours', [0, 1]],
    // Order matters to a tie-break that reads palette indices, so run it
    // both ways: the higher index must drop its face from either side.
    ['the same pair, reversed', [1, 0]],
    ['translucent against opaque', [0, 2]],
    ['opaque against translucent', [2, 0]],
    ['a translucent voxel between two opaques', [2, 0, 2]],
    // SPEC §7.4: an index no palette entry defines is opaque magenta, so it
    // hides like an opaque neighbour in both builders.
    ['an unresolved index beside a translucent one', [0, 7]],
  ];

  for (const [label, row] of cases) {
    it(label, () => {
      const part = rowPart(row);
      expect(meshFaces(part, PALETTE)).toEqual(sceneFaces(part, PALETTE));
    });
  }

  // Where two different translucent colours meet, BOTH keep their face — one
  // facing each way. They are coincident, which looks alarming and is not:
  // CCW-from-outside winding means back-face culling keeps exactly one from
  // any viewpoint, and it keeps the right one. Drop to a single face and the
  // boundary shows from one side and vanishes from the other.
  it('puts a face on BOTH sides where two translucent colours meet', () => {
    const part = rowPart([0, 1]);
    const onPlane = buildSceneFromParts(
      [
        {
          part,
          remap: null,
          transform: { pos: [0, 0, 0], quat: QUAT_IDENTITY },
        },
      ],
      PALETTE,
    ).quads.filter((q) => q.corners.every((c) => c[0] === 1));
    expect(onPlane).toHaveLength(2);
    expect(onPlane.map((q) => q.normal).sort()).toEqual([[-1, 0, 0], [1, 0, 0]]);
    // Each side carries its OWN colour, which is what makes culling pick the
    // colour you are looking through rather than the one behind it.
    const plusX = onPlane.find((q) => q.normal[0] === 1)!;
    expect(plusX.color[2]).toBeCloseTo(A.b / 255, 6); // blue keeps +X
  });
});
