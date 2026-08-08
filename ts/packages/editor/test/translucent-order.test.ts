import { describe, expect, it } from 'vitest';
import { MATTE, type Palette, type Part } from '@cuboidy/core';
import { buildPartGeometry, makeTranslucentSorter } from '@cuboidy/ui';
import { Mesh, PerspectiveCamera, Vector3 } from 'three';

// three.js sorts transparent OBJECTS back to front and never the triangles
// inside one, so a part drawn as a single mesh blended in buildMesh's
// emission order — correct from at most one direction. core's software
// renderer sorts (render/snapshot.ts), so the editor was disagreeing with
// the renderer that defines what a model looks like.

const T: Palette[number] = { r: 58, g: 160, b: 255, a: 0x66, ...MATTE };
const O: Palette[number] = { r: 184, g: 190, b: 198, a: 255, ...MATTE };
const PALETTE: Palette = [T, O];

// A column h voxels tall of one palette index, pivot at the origin corner.
function column(h: number, index: number): Part {
  return {
    name: 'p',
    size: { w: 1, h, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: Array.from({ length: h }, () => [[index]]),
  };
}

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.lookAt(new Vector3(0.5, 2.5, 0.5));
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return camera;
}

// View-space z of each translucent quad, in the order the index buffer now
// draws them. Farther is more negative, so "back to front" is ascending.
function drawnDepths(
  mesh: Mesh,
  camera: PerspectiveCamera,
  opaqueIndexCount: number,
): number[] {
  const geometry = mesh.geometry;
  const index = geometry.getIndex()!;
  const position = geometry.getAttribute('position');
  const modelView = camera.matrixWorldInverse.clone().multiply(mesh.matrixWorld);
  const out: number[] = [];
  for (let i = opaqueIndexCount; i < index.count; i += 6) {
    // A quad's four distinct corners are the first triangle's three plus
    // the second triangle's last.
    const corners = [0, 1, 2, 5].map((k) => index.getX(i + k));
    const c = new Vector3();
    for (const v of corners) {
      c.add(new Vector3(position.getX(v), position.getY(v), position.getZ(v)));
    }
    out.push(c.divideScalar(4).applyMatrix4(modelView).z);
  }
  return out;
}

// The sorter keys off Float32 centroids and this file recomputes them in
// Float64, so two coplanar quads can land a few ULPs apart and tie in one
// and not the other. Either order is correct for equal depth; the tolerance
// says so rather than pinning a tie-break nothing promises.
function expectBackToFront(depths: readonly number[]): void {
  expect(depths.length).toBeGreaterThan(1);
  for (let i = 1; i < depths.length; i++) {
    const slack = 1e-5 * Math.max(1, Math.abs(depths[i - 1]!));
    expect(depths[i]!).toBeGreaterThanOrEqual(depths[i - 1]! - slack);
  }
}

function meshFor(part: Part): {
  mesh: Mesh;
  opaqueIndexCount: number;
  sort: ReturnType<typeof makeTranslucentSorter>;
} {
  const { geometry, opaqueIndexCount } = buildPartGeometry(part, PALETTE);
  const mesh = new Mesh(geometry);
  mesh.updateMatrixWorld(true);
  const sort = makeTranslucentSorter(() => mesh, geometry, opaqueIndexCount);
  return { mesh, opaqueIndexCount, sort };
}

describe('makeTranslucentSorter', () => {
  it('orders translucent quads farthest-first for the given camera', () => {
    const { mesh, opaqueIndexCount, sort } = meshFor(column(5, 0));
    const camera = cameraAt(8, -6, 8);
    sort(null, null, camera);

    expectBackToFront(drawnDepths(mesh, camera, opaqueIndexCount));
  });

  it('re-sorts when the camera moves to the opposite side', () => {
    const { mesh, opaqueIndexCount, sort } = meshFor(column(5, 0));
    const index = mesh.geometry.getIndex()!;

    sort(null, null, cameraAt(8, -6, 8));
    const first = Array.from(index.array);

    const behind = cameraAt(-8, -6, -8);
    sort(null, null, behind);
    const second = Array.from(index.array);

    expect(second).not.toEqual(first);
    expectBackToFront(drawnDepths(mesh, behind, opaqueIndexCount));
  });

  it('leaves the opaque prefix alone', () => {
    // One translucent voxel stacked on one opaque voxel, so the buffer has
    // both ranges and a bad sort would be visible as a disturbed prefix.
    const part: Part = {
      name: 'p',
      size: { w: 1, h: 2, d: 1 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      voxels: [[[1]], [[0]]],
    };
    const { mesh, opaqueIndexCount, sort } = meshFor(part);
    expect(opaqueIndexCount).toBeGreaterThan(0);
    const index = mesh.geometry.getIndex()!;
    const before = Array.from(index.array).slice(0, opaqueIndexCount);

    sort(null, null, cameraAt(8, -6, 8));

    expect(Array.from(index.array).slice(0, opaqueIndexCount)).toEqual(before);
  });

  it('is a no-op for a model with no translucent colour', () => {
    const { mesh, sort } = meshFor(column(5, 1));
    const index = mesh.geometry.getIndex()!;
    const before = Array.from(index.array);

    sort(null, null, cameraAt(8, -6, 8));

    expect(Array.from(index.array)).toEqual(before);
  });
});
