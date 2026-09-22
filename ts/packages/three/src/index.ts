// three.js for Cuboidy models. No React, no editor: everything here needs
// a `three` and a `@cuboidy/core` and nothing else.
//
// The line: this package turns a MODEL into three.js objects — geometry,
// materials, draw order, the rig that places the parts, and the lighting a
// voxel model is meant to be seen under. It knows nothing about a document,
// a viewport, a selection or a tool. That is what makes it usable from a
// plain `<script>` on a page (see `npm run bundle`), from a React app
// through `@cuboidy/r3f`, and from a renderer that has no DOM at all beyond
// the canvas.

// ─── A whole package, as one object ─────────────────────────────────────
export { buildModelObject } from './model-object.js';
export type { ModelObject, ModelSource } from './model-object.js';

// ─── The rig: hierarchy, framing, SPEC §7.7 placement ───────────────────
export {
  buildRigTreeOf,
  computeSceneBounds,
  computeSceneCenter,
  computeSceneSpan,
} from './rig.js';
export type { PartLayout, RigNode, Span } from './rig.js';
export { REST_POSE, partPlacement } from './part-placement.js';
export type { PartPlacement } from './part-placement.js';

// ─── One part: voxels → a BufferGeometry, §7.4 → materials ──────────────
export { buildPartGeometry } from './part-geometry.js';
export type { PartGeometry } from './part-geometry.js';
export { buildPartMaterials, disposeMaterials } from './part-materials.js';
export { makeTranslucentSorter } from './translucent-order.js';
export type { SortTranslucent } from './translucent-order.js';

// ─── The studio: what a model is lit by and seen against ────────────────
export { studioGridSpec } from './studio-grid.js';
export type { StudioGridSpec } from './studio-grid.js';
export {
  STUDIO_AMBIENT,
  STUDIO_FILL,
  STUDIO_KEY,
  addStudioLighting,
} from './studio-lighting.js';
export { makeStudioEnvironment } from './environment.js';
export type { StudioEnvironment } from './environment.js';

// ─── Overlay drawing primitives ─────────────────────────────────────────
export {
  AXIS_COLORS,
  GIZMO_FRAME_COLOR,
  GIZMO_MARKER_COLOR,
  GIZMO_SOCKET_ACTIVE_COLOR,
  GIZMO_SOCKET_COLOR,
  axisCross,
  noRaycast,
  srgbToLinear,
  srgbToLinearArray,
} from './gizmo-primitives.js';
