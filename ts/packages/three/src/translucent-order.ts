import { Matrix4, type BufferGeometry, type Camera, type Object3D } from 'three';

// three.js sorts transparent OBJECTS back to front; it never sorts the
// triangles inside one. A part is a single mesh, so without this its
// translucent faces blend in whatever order `buildMesh` emitted them (y,
// then z, then x) — one fixed order, correct from at most one direction,
// and wrong in a way that changes as you orbit.
//
// core's software renderer already sorts (render/snapshot.ts: translucent
// quads by mean corner depth, farthest first). So leaving the editor
// unsorted is not a quality shortcut — it is the editor disagreeing with
// the renderer that defines what a model looks like.
//
// Same key here: the mean of a quad's four corners, farthest first. The CLI
// measures depth along an orthographic view direction and the editor has a
// perspective camera, so the two agree on ordering rather than on numbers.

// A quad is 4 vertices / 6 indices, laid out (0,1,2)+(0,2,3) by mesh.ts.
// The six original indices are snapshotted and permuted as a unit, so the
// permutation itself survives a change of triangulation — but the centroid
// loop below does assume this layout when it picks the four distinct
// corners out of the six.
const INDICES_PER_QUAD = 6;

// Call this BEFORE `renderer.render`, once per frame, with the camera the
// frame will be drawn from.
//
// It must not be hung on `object.onBeforeRender`, which is the obvious
// place and is wrong. three.js reads `geometry.groups` in `projectObject`
// and pushes references to those group objects into the render list;
// `onBeforeRender` only fires later, from `renderObject`. Rebuilding groups
// there leaves the render list holding the PREVIOUS frame's ranges while
// the index buffer — uploaded during `renderBufferDirect`, same frame —
// holds the new order. The two disagree and blended quads draw with another
// material's metalness, roughness and emissive.
//
// In the editor that was a per-frame flicker while orbiting; in the
// workspace thumbnail, which renders exactly once, the first frame IS the
// output, so a library card was permanently wrong.
export type SortTranslucent = (camera: Camera) => void;

const NOTHING_TO_SORT: SortTranslucent = () => {};

// A model with no translucent color — the common case — gets a no-op, so
// the per-frame cost of supporting translucency is a call that returns.
export function makeTranslucentSorter(
  object: () => Object3D | null,
  geometry: BufferGeometry,
  opaqueIndexCount: number,
  // Material index per translucent quad, in buffer order. Omit when the
  // part has a single translucent material and groups need no rebuilding.
  quadMaterials?: Uint16Array | undefined,
): SortTranslucent {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (index === null || position === undefined) return NOTHING_TO_SORT;
  const blended = index.count - opaqueIndexCount;
  if (blended <= 0) return NOTHING_TO_SORT;

  // Depth order and material order are independent, so once TWO translucent
  // materials share a part the fixed group boundaries stop being usable: a
  // depth sort interleaves them. The groups get rebuilt per frame in that
  // case, coalescing the sorted quads into runs of one material. It costs a
  // few extra draw calls and it is the only way both orderings hold.
  //
  // The single-material case — glass, or one glowing colour, which is
  // almost always what a part has — skips all of it.
  const opaqueGroups = geometry.groups.filter(
    (g) => g.start < opaqueIndexCount,
  );
  const rebuildGroups =
    quadMaterials !== undefined &&
    new Set(quadMaterials).size > 1 &&
    geometry.groups.length > 0;

  const quadCount = blended / INDICES_PER_QUAD;
  const original = new Uint32Array(blended);
  // Local-space centroid per translucent quad, computed once. The quad's
  // four vertices are the three distinct indices of its first triangle plus
  // the last of its second — reading all six and dividing by six weights
  // two corners double, which would bias the key.
  const centroids = new Float32Array(quadCount * 3);
  for (let q = 0; q < quadCount; q++) {
    const base = opaqueIndexCount + q * INDICES_PER_QUAD;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < INDICES_PER_QUAD; k++) {
      const vi = index.getX(base + k);
      original[q * INDICES_PER_QUAD + k] = vi;
      if (k === 3) continue; // (0,2,3): 0 and 2 already counted
      if (k === 4) continue;
      cx += position.getX(vi);
      cy += position.getY(vi);
      cz += position.getZ(vi);
    }
    centroids[q * 3] = cx / 4;
    centroids[q * 3 + 1] = cy / 4;
    centroids[q * 3 + 2] = cz / 4;
  }

  const order = new Uint32Array(quadCount);
  for (let q = 0; q < quadCount; q++) order[q] = q;
  const depths = new Float32Array(quadCount);
  const modelView = new Matrix4();
  const viewInverse = new Matrix4();
  const lastModelView = new Matrix4();
  let sorted = false;

  return (camera) => {
    const obj = object();
    if (obj === null) return;
    // Both matrices are refreshed here rather than trusted. Running before
    // the render means running before three's own `scene.updateMatrixWorld`
    // and `camera.updateMatrixWorld`, so whatever is on the objects is one
    // frame old — which during an orbit or an animated rig is exactly when
    // the ordering matters.
    obj.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    viewInverse.copy(camera.matrixWorld).invert();
    modelView.multiplyMatrices(viewInverse, obj.matrixWorld);
    // An editor camera is stationary most frames, so re-sort only when the
    // view actually moved.
    if (sorted && lastModelView.equals(modelView)) return;
    lastModelView.copy(modelView);
    sorted = true;

    // View space looks down −Z, so the farthest quad has the smallest z
    // and "farthest first" is ascending.
    const e = modelView.elements;
    for (let q = 0; q < quadCount; q++) {
      const x = centroids[q * 3]!;
      const y = centroids[q * 3 + 1]!;
      const z = centroids[q * 3 + 2]!;
      depths[q] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    order.sort((a, b) => depths[a]! - depths[b]!);

    const array = index.array as Uint16Array | Uint32Array;
    for (let k = 0; k < quadCount; k++) {
      const from = order[k]! * INDICES_PER_QUAD;
      const to = opaqueIndexCount + k * INDICES_PER_QUAD;
      for (let i = 0; i < INDICES_PER_QUAD; i++) {
        array[to + i] = original[from + i]!;
      }
    }
    index.needsUpdate = true;

    if (!rebuildGroups) return;
    // Runs of one material in the NEW order. Opaque groups are untouched —
    // nothing reorders them.
    geometry.clearGroups();
    for (const g of opaqueGroups) geometry.addGroup(g.start, g.count, g.materialIndex);
    let runStart = 0;
    for (let k = 1; k <= quadCount; k++) {
      const ending = k === quadCount || quadMaterials[order[k]!] !== quadMaterials[order[runStart]!];
      if (!ending) continue;
      geometry.addGroup(
        opaqueIndexCount + runStart * INDICES_PER_QUAD,
        (k - runStart) * INDICES_PER_QUAD,
        quadMaterials[order[runStart]!]!,
      );
      runStart = k;
    }
  };
}
