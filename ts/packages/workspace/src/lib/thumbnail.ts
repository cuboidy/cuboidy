import {
  ANGLES,
  QUAT_IDENTITY,
  cameraDir,
  worldTransformsFor,
} from '@cuboidy/core';
import {
  addStudioLighting,
  buildPartGeometry,
  buildPartMaterials,
  makeTranslucentSorter,
  type SortTranslucent,
} from '@cuboidy/three';
import {
  Group,
  Mesh,
  OrthographicCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { LibraryModel } from './library.js';
import { modelBounds } from './bounds.js';

// A still picture of each model, for the library cards and for the image
// that follows the cursor while one is dragged.
//
// ONE renderer for the whole library, not a <Canvas> per card. Browsers
// cap simultaneous WebGL contexts at around eight to sixteen, so a folder
// of twenty models would simply stop drawing partway down the list — and
// a thumbnail does not move, so paying for a live context per card buys
// nothing even where it fits.
//
// The angle is `fr-up` from @cuboidy/core — the same three-quarter view
// cuboidy-snap puts first in its contact sheet. A card and a snapshot
// showing the model differently would read as two products.

const ANGLE = ANGLES['fr-up']!;
// Rendered at 2x and shown at half, so the image is crisp on a HiDPI
// screen without asking the display for its ratio (which would make the
// cache depend on which monitor the window is on).
const SIZE = 176;

export interface Thumbnail {
  // A PNG data URL, transparent outside the model.
  url: string;
  // The CSS size the image is meant to be shown at.
  px: number;
}

// Render every model once. Yields between models so a large library does
// not freeze the UI in one long frame; the caller gets each result as it
// lands rather than waiting for the whole set.
export async function renderThumbnails(
  models: readonly LibraryModel[],
  onEach: (dir: string, thumb: Thumbnail) => void,
  // Aborts the run — the user opened a different folder, and finishing
  // the old one would both waste work and race the new results in.
  signal?: { aborted: boolean },
): Promise<void> {
  if (models.length === 0) return;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return; // no WebGL here; cards fall back to their placeholder
  }
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearAlpha(0);

  try {
    for (const model of models) {
      if (signal?.aborted === true) return;
      const url = renderOne(renderer, model);
      if (url !== null) onEach(model.dir, { url, px: SIZE / 2 });
      // One frame back to the browser between models.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

function renderOne(renderer: WebGLRenderer, model: LibraryModel): string | null {
  const box = modelBounds(model);
  if (box === null) return null;

  const scene = new Scene();
  const sorters: SortTranslucent[] = [];
  const group = buildModelGroup(model, sorters);
  scene.add(group);
  // The same rig the scene views use — literally the same module, because
  // the previous version of this comment claimed the same thing while
  // running 0.75 ambient against the scene view's 0.12.
  const teardownLighting = addStudioLighting(scene, renderer);

  // Orthographic, like cuboidy-snap: a voxel model reads best without
  // perspective, and it also means the frame can be computed exactly
  // rather than guessed from a field of view.
  const [cx, cy, cz] = box.center;
  const radius =
    0.5 * Math.hypot(box.size[0], box.size[1], box.size[2]) || 1;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 8);
  const dir = cameraDir(ANGLE);
  camera.position.set(
    cx + dir[0] * radius * 4,
    cy + dir[1] * radius * 4,
    cz + dir[2] * radius * 4,
  );
  camera.lookAt(cx, cy, cz);
  camera.updateMatrixWorld();

  // Fit to the SILHOUETTE, not to the bounding sphere. Sizing by the
  // diagonal is the safe choice — nothing can clip at any angle — but it
  // is the diagonal that fills the square, so every model ends up
  // noticeably small inside it, and a tall thin one worst of all. The
  // eight corners pushed through the camera's own view matrix give the
  // extent that is actually on screen.
  let ex = 0;
  let ey = 0;
  const corner = new Vector3();
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        corner
          .set(cx + box.size[0] * sx, cy + box.size[1] * sy, cz + box.size[2] * sz)
          .applyMatrix4(camera.matrixWorldInverse);
        ex = Math.max(ex, Math.abs(corner.x));
        ey = Math.max(ey, Math.abs(corner.y));
      }
    }
  }
  // Square, so the image is not distorted; a little air so the silhouette
  // never touches the card's edge.
  const half = Math.max(ex, ey, 0.5) * 1.06;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();

  // Depth-sort every translucent part for THIS camera before drawing.
  for (const sort of sorters) sort(camera);
  renderer.render(scene, camera);
  teardownLighting();
  const url = renderer.domElement.toDataURL('image/png');

  disposeGroup(group);
  return url;
}

// The model at rest, parts placed by the rig — plain three.js, because a
// thumbnail needs no React root and no r3f. The mesh data and the rest
// transforms both come from core, so a card cannot disagree with the
// scene view about what the model looks like.
function buildModelGroup(
  model: LibraryModel,
  sorters: SortTranslucent[],
): Group {
  const group = new Group();
  const transforms = worldTransformsFor(model.manifest, model.parts);
  for (const [name, resolved] of model.parts) {
    const part = resolved.part;
    // The very same calls PartMesh makes, so a card cannot disagree with
    // the scene view about geometry, colour, SPEC §7.4 opacity or §7.4
    // material. This used to build its own Lambert materials and read
    // neither `alphas` nor the material buckets, which made a translucent
    // model solid and a polished one matte — under a comment promising the
    // card could not disagree with the scene view.
    const built = buildPartGeometry(part, resolved.palette);
    const { geometry, opaqueIndexCount } = built;
    if (geometry.getIndex()?.count === 0) continue; // all-air draws nothing

    const materials = buildPartMaterials(built.materials);
    const obj = new Mesh(
      geometry,
      materials.length === 1 ? materials[0]! : materials,
    );
    // Blended faces need to be drawn back to front, and three.js only
    // orders whole objects. Collected and run by the caller just before
    // `renderer.render`, NOT hung on `obj.onBeforeRender` — three reads
    // `geometry.groups` in `projectObject`, before that hook fires, so a
    // group rebuild there would land a frame late. Here there IS no next
    // frame: one render, so a card would have been permanently wrong. See
    // @cuboidy/three's translucent-order.
    sorters.push(
      makeTranslucentSorter(
        () => obj,
        geometry,
        opaqueIndexCount,
        built.translucentQuadMaterials,
      ),
    );
    const wt = transforms.get(name) ?? { pos: [0, 0, 0], quat: QUAT_IDENTITY };
    // A part's world transform places its PIVOT at wt.pos, so the mesh —
    // whose local origin is the voxel grid's corner — is offset by −pivot
    // inside a group sitting at that point.
    const holder = new Group();
    holder.position.set(wt.pos[0], wt.pos[1], wt.pos[2]);
    holder.quaternion.copy(
      new Quaternion(wt.quat[0], wt.quat[1], wt.quat[2], wt.quat[3]),
    );
    obj.position.set(-part.pivot.pos.x, -part.pivot.pos.y, -part.pivot.pos.z);
    holder.add(obj);
    group.add(holder);
  }
  return group;
}

function disposeGroup(group: Group): void {
  group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}
