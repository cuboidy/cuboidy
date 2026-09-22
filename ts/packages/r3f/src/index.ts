// The Cuboidy scene, as react-three-fiber components.
//
// The line: everything here belongs INSIDE a `<Canvas>`. It draws a model,
// the overlays that let one be picked apart, and the studio it is seen in.
// It knows nothing about a document, a panel, a dock or a stylesheet —
// `@cuboidy/ui` is where those live, and it does not depend on this.
//
// What the components actually do with a model is `@cuboidy/three`'s:
// geometry, materials, draw order and SPEC §7.7 placement are all computed
// there, so a page drawing the same model without React gets the same
// picture.

export { RiggedParts } from './RiggedParts.js';
export type { VoxelStrokeHandlers } from './RiggedParts.js';
export { PartMesh } from './PartMesh.js';
export { PartGizmos } from './PartGizmos.js';
export type { GizmoPicking } from './PartGizmos.js';
export { TransformGizmoHost } from './TransformGizmoHost.js';

export { StudioLighting } from './StudioLighting.js';
export { StudioGrid } from './StudioGrid.js';
export {
  StudioBackground,
  studioBackgroundColor,
} from './StudioBackground.js';

export type { GizmoVisibility, TransformSubTarget } from './view-types.js';
