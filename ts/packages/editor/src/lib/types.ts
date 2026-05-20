import type { Cvox, Manifest } from '@cuboidy/core';

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
    };

// Result of attempting a load. `source` is undefined on hard parse
// failures; `error` is the user-facing message in that case.
export interface LoadResult {
  source?: LoadedSource;
  error?: string;
  // Always populated for UI feedback ("could not parse X.cvox").
  cvoxFileName?: string;
}

// View modes for the 3D scene. Rig view requires a manifest; the UI
// disables the toggle when no manifest is loaded.
export type ViewMode = 'cbox' | 'rig';
