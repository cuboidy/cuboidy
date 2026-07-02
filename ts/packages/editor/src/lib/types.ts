import type {
  Cvox,
  InlineAnimation,
  KeyAttr,
  Manifest,
  Palette,
} from '@cuboidy/core';

// What the editor currently has loaded. Two discriminated kinds keep the
// possible states explicit; the absence of `handle` in the folder kind
// signals "no in-place writeback" (Save will fall back to download).
//
// Both kinds carry the originating file text alongside the parsed AST so
// the editor can re-export untouched files verbatim (preserving raw
// formatting and comments that the parser dropped). Once edits land,
// the source-of-truth for affected files will be the AST plus a re-
// serialize, but for now (read-only viewer) text passthrough is enough.

export interface FileEntry {
  name: string;
  text: string;
}

export type LoadedSource =
  | {
      kind: 'cvox-only';
      cvox: Cvox;
      cvoxFile: FileEntry;
      droppedInlineComments: number;
    }
  | {
      kind: 'folder';
      folderName: string;
      // Synthetic folders are created in-editor (Create manifest from a
      // cvox-only load). They have no original disk location, so Save
      // must always go through a file picker / download path.
      synthetic: boolean;
      // FSA-aware drop or showDirectoryPicker on Chrome/Edge populates
      // this. When present, Save can write back to the original folder.
      handle?: FileSystemDirectoryHandle;
      cvox: Cvox;
      cvoxFile: FileEntry;
      // Manifest is optional inside a folder — a folder that contains
      // only voxels.cvox (no cuboidy.json) is a valid folder load.
      manifest?: Manifest;
      manifestFile?: FileEntry;
      manifestError?: string;
      droppedInlineComments: number;
      // ── v0.7 project layer (SPEC §6.9/§6.10), populated at load ──
      // Every text file in the package, keyed by /-relative path. The two
      // LIVE-edited files above (cvoxFile / manifestFile) hold the current
      // text; this map holds the load-time snapshot of everything else.
      // Absent on synthetic folders (they have no other files).
      files?: ReadonlyMap<string, FileEntry>;
      // All geometry files that parsed, keyed by their (normalized)
      // manifest `geometry` ref. Includes the primary (= cvoxFile) entry.
      // The editor still edits only the primary until Phase C.
      geometries?: ReadonlyMap<string, Cvox>;
      // Parsed manifest-bound palette (§6.10). Rendering prefers this
      // over the inline cvox palette, matching the spec precedence.
      externalPalette?: Palette;
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
    };

// Result of attempting a load. `source` is undefined on hard parse
// failures; `error` is the user-facing message in that case.
export interface LoadResult {
  source?: LoadedSource;
  error?: string;
  // Always populated for UI feedback ("could not parse X.cvox").
  cvoxFileName?: string;
}

// View modes for the 3D scene. Rig view requires a manifest; anim view
// additionally requires the manifest to define at least one inline
// animation. The UI disables each toggle when its requirement is unmet.
export type ViewMode = 'cvox' | 'rig' | 'anim';

// A keyframe selected in the animation timeline: one attribute (rot/pos/
// scale/visible) of one part at one time-key. The per-attribute model means
// selection is an (attribute, time) pair, not a whole-keyframe marker.
export interface SelectedKey {
  part: string;
  attr: KeyAttr;
  timeKey: string;
}
