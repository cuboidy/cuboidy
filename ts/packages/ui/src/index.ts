// Editor UI shared between the model editor and anything else that shows a
// Cuboidy model — a scene workspace above all.
//
// The line: this package knows about a MODEL (core's types) and about
// drawing and arranging one. It knows nothing about a document — no
// loading, no saving, no `LoadedSource`. That is what makes it usable by an
// app whose unit is a scene of several models rather than a single package.

export { Dock } from './Dock.js';
export type { PanelContent } from './Dock.js';

export {
  addPanelAt,
  closePanelAt,
  filePanel,
  filePanelPath,
  initialLayout,
  isPanelVisible,
  openPanelById,
  placePanelBeside,
  placedPanels,
  splitLeafWith,
  withActiveAt,
  withRatioAt,
  ALL_PANELS,
} from './layout.js';
export type { Edge, LayoutNode, LeafId, Side } from './layout.js';

export { historyReducer, makeHistory, COALESCE_MS, HISTORY_CAP } from './history.js';
export type { HistoryAction, HistoryState } from './history.js';

export { buildRigTree, computeSceneCenter, computeSceneSpan } from './rig.js';
export type { RigNode, Span } from './rig.js';

export { RiggedParts } from './scene/RiggedParts.js';
export type { VoxelStrokeHandlers } from './scene/RiggedParts.js';
export { PartMesh } from './scene/PartMesh.js';
export { PartGizmos } from './scene/PartGizmos.js';
export type { GizmoPicking } from './scene/PartGizmos.js';
export { TransformGizmo } from './scene/TransformGizmo.js';

export type {
  GizmoVisibility,
  PreviewTool,
  SelectedKey,
  TransformSubTarget,
  ViewMode,
  VoxelEdit,
} from './view-types.js';
