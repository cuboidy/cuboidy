import type {
  Geometry,
  InlineAnimation,
  KeyAttr,
  Manifest,
  Palette,
  Part,
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
// ONE text store. `files` holds every file in the package, INCLUDING the
// primary geometry and the manifest; `primaryPath` / `manifestPath` just
// name which entries those are. Previously each of those two lived in a
// second slot of its own (`geometryFile` / `manifestFile`) that shadowed
// the map, so every reader had to adjudicate which copy was newer —
// `path === src.geometryFile.name ? src.geometry : g` and its friends —
// and every writer had to update both. That whole question is gone.
//
// The text is kept alongside the parsed AST so untouched files re-export
// verbatim (preserving formatting the parser drops). A structural edit
// re-serializes the AST into the text; a source-panel edit reparses the
// text into the AST.

export interface LoadedSource {
  // The package's display name (the Files tree root). Always present:
  // every load is a package now, anchored by a manifest (SPEC §3). A
  // single loose file is read AS that manifest, so it is a package too —
  // there is no longer a lesser kind of document.
  folderName: string;
  // FSA-aware drop or showDirectoryPicker on Chrome/Edge populates
  // this. When present, Save can write back to the original folder.
  handle?: FileSystemDirectoryHandle;
  // Every text file in the package, keyed by /-relative path. The single
  // store: nothing else holds a file's bytes.
  files: ReadonlyMap<string, string>;
  // Entries this editor does not understand — a thumbnail, a licence,
  // another tool's sidecar — carried verbatim so a load/save round trip
  // cannot silently drop them (SPEC §13.3). Nothing reads them; Export
  // writes them back unchanged.
  assets?: ReadonlyMap<string, Uint8Array>;
  // Which entry is the model's primary geometry FILE — the one the
  // geometry panel edits. ABSENT when the model has no geometry file at
  // all: since SPEC §6.13 a part may carry its shape in the manifest, so
  // an all-inline model is one `cuboidy.json` and there is no such file.
  //
  // Deliberately not faked with a synthetic `cuboidy.json` entry in
  // `geometries`. That map is file-backed one-to-one with `files`, and
  // writeFile keeps the two in step; a synthetic key would make
  // `geometries[p]` and `files[p]` mean different documents at exactly
  // one path, which is the drift this shape exists to prevent.
  primaryPath?: string;
  // SPEC §6.13: parts whose shape is written INLINE in the manifest,
  // keyed by part name. Their text is the manifest's, so they are not in
  // `geometries` — but every reader that asks "what parts does this model
  // have?" must see them, which is what mergeGeometries() is for.
  //
  // Carries the resolved `palette` alongside the shape because an inline
  // part has no file to read colors from: they come from its own
  // `palette`, else the manifest's (§6.13), and resolving that twice in
  // two places is how the render and the editor would come to disagree.
  inlineParts?: ReadonlyMap<string, { part: Part; palette: Palette }>;
  // Which entry is cuboidy.json. Always present — it is what makes the
  // load a model at all (§3); a folder without one fails to load.
  manifestPath: string;
  // The parsed manifest, ABSENT when its text does not parse. That case
  // still loads: the editor exists to fix it, and the text has to be on
  // screen to be fixed. `manifestError` says what is wrong.
  manifest?: Manifest;
  manifestError?: string;
  // All geometry files that parsed, keyed by their (normalized) manifest
  // `geometry` ref, INCLUDING the primary. §7.4 palette references are
  // already resolved into each one.
  geometries: ReadonlyMap<string, Geometry>;
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

// Preview toolbar tools. 'select'
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

// What the transform tools are gripping within the selected part: the part
// body itself, its pivot marker, or one of its socket markers. Picked by
// clicking the marker; resets to the body on selection change.
export type TransformSubTarget =
  | { kind: 'part' }
  | { kind: 'pivot' }
  | { kind: 'socket'; socket: string };

// One cell of a voxel-tool stroke, in part-local voxel
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
