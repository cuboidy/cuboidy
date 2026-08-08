// Editor UI shared between the model editor and anything else that shows a
// Cuboidy model — a scene workspace above all.
//
// The line: this package knows about a MODEL (core's types) and about
// drawing and arranging one. It knows nothing about a document — no
// loading, no saving, no `LoadedSource`. That is what makes it usable by an
// app whose unit is a scene of several models rather than a single package.

export { AppHeader, HeaderDivider, HeaderGroup } from './AppHeader.js';
export { InlineNameInput } from './InlineNameInput.js';
export { NumberInput } from './NumberInput.js';
export { TextInput } from './TextInput.js';
export { Transport } from './Transport.js';

export {
  ToggleGroup,
  ToolBar,
  ToolOverlay,
  ViewOverlay,
  ViewToggle,
} from './ViewportChrome.js';
export type { ToolBarItem, ViewToggleItem } from './ViewportChrome.js';

export { Dock } from './Dock.js';
export type { PanelContent } from './Dock.js';

export {
  addPanelAt,
  closePanelAt,
  isPanelVisible,
  leaf,
  openPanelById,
  placePanelBeside,
  placedPanels,
  split,
  splitLeafWith,
  withActiveAt,
  withRatioAt,
} from './layout.js';
export type { Edge, LayoutNode, Side } from './layout.js';

export { useDockLayout } from './useDockLayout.js';
export type { DockHandlers, DockLayout } from './useDockLayout.js';

export { historyReducer, makeHistory, COALESCE_MS, HISTORY_CAP } from './history.js';
export type { HistoryAction, HistoryState } from './history.js';
export { isTextEntryTarget, useUndoRedoShortcuts } from './shortcuts.js';
export { UndoRedoGroup } from './UndoRedoGroup.js';
export { SaveButton, useSaveFlash } from './SaveButton.js';
export type { SaveState } from './SaveButton.js';
export { VisibilityButtons } from './VisibilityButtons.js';

export {
  TEXT_FILE_RE,
  canUseDirectoryPicker,
  downloadBlob,
  downloadText,
  ensureReadwritePermission,
  pickDirectory,
  readDirectoryEntry,
  readDirectoryHandle,
  readFileList,
  removeFileAt,
  writeTextFileAt,
} from './fs/browser-fs.js';
export type { PickedFile } from './fs/browser-fs.js';

export { buildRigTree, computeSceneCenter, computeSceneSpan } from './rig.js';

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
} from './scene/gizmo-primitives.js';
export { RiggedParts } from './scene/RiggedParts.js';
export type { VoxelStrokeHandlers } from './scene/RiggedParts.js';
export { PartMesh } from './scene/PartMesh.js';
export { buildPartGeometry } from './scene/part-geometry.js';
export type { PartGeometry } from './scene/part-geometry.js';
export { buildPartMaterials, disposeMaterials } from './scene/part-materials.js';
export { makeStudioEnvironment } from './scene/environment.js';
export { StudioEnvironment } from './scene/StudioEnvironment.js';
export { makeTranslucentSorter } from './scene/translucent-order.js';
export type { BeforeRender } from './scene/translucent-order.js';
export { PartGizmos } from './scene/PartGizmos.js';
export type { GizmoPicking } from './scene/PartGizmos.js';
export { TransformGizmoHost } from './scene/TransformGizmoHost.js';

export type {
  GizmoVisibility,
  PreviewTool,
  SelectedKey,
  TransformSubTarget,
  ViewMode,
  VoxelEdit,
} from './view-types.js';
