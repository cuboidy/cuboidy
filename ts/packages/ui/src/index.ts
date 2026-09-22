// The editor chrome, shared between the model editor and anything else
// built out of the same parts — a scene workspace above all.
//
// The line: this package is what surrounds a 3D view, and never what is
// inside one. A dock, a header, inputs, a transport, undo/redo, the browser
// file pickers, and the stylesheet the three of them are drawn with. The
// model itself is `@cuboidy/three`'s and `@cuboidy/r3f`'s, and neither is a
// dependency here — the arrow points the other way, and the chrome should
// not pull a renderer in behind it.
//
// It also knows nothing about a document — no loading, no saving, no
// `LoadedSource`. That is what makes it usable by an app whose unit is a
// scene of several models rather than a single package.

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

export { treeIndent } from './tree.js';

export type {
  PreviewTool,
  SelectedKey,
  ViewMode,
  VoxelEdit,
} from './view-types.js';
