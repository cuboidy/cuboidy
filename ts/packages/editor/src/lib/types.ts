import type {
  Geometry,
  InlineAnimation,
  KeyAttr,
  Manifest,
} from '@cuboidy/core';

// What the editor currently has loaded.
//
// ONE shape, not a discriminated union. A lone geometry file used to be
// its own `kind`, but only two places ever actually branched on that
// (whether the Files tree draws a package root, and whether Export
// offers a ZIP) while every other reader paid for it with a
// `kind !== 'folder'` narrowing guard it did nothing with. Those two
// places now read `folderName`, and everything else just reads the
// optional field it cares about.
//
// The source carries the originating file text alongside the parsed AST
// so the editor can re-export untouched files verbatim (preserving raw
// formatting the parser dropped). A structural edit re-serializes the
// AST into that text; a source-panel edit reparses the text into the AST.

export interface FileEntry {
  name: string;
  text: string;
}

export interface LoadedSource {
  // The package's display name (the Files tree root). ABSENT means the
  // load was a single geometry file with no package around it: the tree
  // draws a flat file row instead of a root, and Export offers no ZIP.
  // "Create manifest" gives such a load a name, promoting it to a package.
  folderName?: string;
  // Synthetic packages are created in-editor (Create manifest from a
  // bare-geometry load). They have no original disk location, so Save
  // must always go through a file picker / download path.
  synthetic: boolean;
  // FSA-aware drop or showDirectoryPicker on Chrome/Edge populates
  // this. When present, Save can write back to the original folder.
  handle?: FileSystemDirectoryHandle;
  geometry: Geometry;
  geometryFile: FileEntry;
  // Optional: a folder containing only voxels.json (no cuboidy.json) is
  // a valid load, as is a bare geometry file.
  manifest?: Manifest;
  manifestFile?: FileEntry;
  manifestError?: string;
  // ── v0.7 project layer (SPEC §6.9/§6.10), populated at load ──
  // Every text file in the package, keyed by /-relative path. The two
  // LIVE-edited files above (geometryFile / manifestFile) hold the current
  // text; this map holds the load-time snapshot of everything else.
  // Absent on synthetic packages (they have no other files).
  files?: ReadonlyMap<string, FileEntry>;
  // All geometry files that parsed, keyed by their (normalized)
  // manifest `geometry` ref. Includes the primary (= geometryFile) entry.
  geometries?: ReadonlyMap<string, Geometry>;
  // Resolved external animations (§6.3 string refs), keyed by CLIP
  // name. The manifest keeps the reference path; clip edits
  // re-serialize into the referenced file (files map), never into
  // the manifest.
  externalAnims?: ReadonlyMap<string, { path: string; anim: InlineAnimation }>;
  // Load problems in referenced files beyond the primary pair
  // (missing/unparsable geometry refs, palette issues). Surfaced in
  // the Console panel.
  projectErrors?: ReadonlyArray<{ file: string; message: string }>;
  // Paths deleted (or renamed away) in the editor since load. Save
  // removes them from disk (ignoring already-gone ones, so the set
  // never needs clearing); ZIP export omits them naturally. Part of
  // the undoable source state — undo restores the file AND unmarks
  // the removal.
  removedFiles?: ReadonlySet<string>;
}

// Result of attempting a load. `source` is undefined on hard parse
// failures; `error` is the user-facing message in that case.
export interface LoadResult {
  source?: LoadedSource;
  error?: string;
  // Always populated for UI feedback ("could not parse X.json").
  geometryFileName?: string;
}

// View modes for the 3D scene. Rig view requires a manifest; anim view
// additionally requires the manifest to define at least one inline
// animation. The UI disables each toggle when its requirement is unmet.
export type ViewMode = 'geometry' | 'rig' | 'anim';

// Per-kind visibility of the selected part's 3D preview gizmos (pivot
// marker, socket markers, bounding frame), toggled from the preview
// overlay. The flags outlive any one selection — gizmos simply render
// only while a part is selected.
export interface GizmoVisibility {
  pivot: boolean;
  sockets: boolean;
  frame: boolean;
}

// Preview toolbar tools (docs/preview-editing-design.md §2.1). 'select'
// is the safe default: nothing model-mutating can happen in it. A tool
// that isn't usable in the current view is disabled in the toolbar and
// the effective tool falls back to 'select' without losing the user's
// choice.
export type PreviewTool =
  | 'select'
  | 'move'
  | 'rotate'
  | 'attach'
  | 'erase'
  | 'paint';

// What the transform tools are gripping within the selected part
// (design §2.4): the part body itself, its pivot marker, or one of its
// socket markers. Picked by clicking the marker; resets to the body on
// selection change.
export type TransformSubTarget =
  | { kind: 'part' }
  | { kind: 'pivot' }
  | { kind: 'socket'; socket: string };

// One cell of a voxel-tool stroke (design §2.6), in part-local voxel
// coords. `value` is a palette index, or AIR for an erase.
export interface VoxelEdit {
  x: number;
  y: number;
  z: number;
  value: number;
}

// A keyframe selected in the animation timeline: one attribute (rot/pos/
// scale/visible) of one part at one time-key. The per-attribute model means
// selection is an (attribute, time) pair, not a whole-keyframe marker.
export interface SelectedKey {
  part: string;
  attr: KeyAttr;
  timeKey: string;
}
