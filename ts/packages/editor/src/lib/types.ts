import type { Geometry, InlineAnimation, Manifest, ResolvedPart } from '@cuboidy/core';

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
  // SPEC §6.13: EVERY manifest part bound to its shape, keyed by the name
  // the rig uses, straight from core's resolvePartGeometry.
  //
  // This is the model. The editor used to keep only the inline entries
  // here and re-derive the rest by matching part names across geometry
  // files — resolving twice, with the second pass not knowing about §6.13.
  // A shape reached through `geometry.part`, or shared by two rig parts,
  // came out under the FILE's name: a two-wheeled cart showed one part
  // called `wheel` and the rig, the animation bindings and the edit
  // routing all disagreed with it. Reading core's answer instead of
  // recomputing a worse one is the whole fix.
  parts: ReadonlyMap<string, ResolvedPart>;
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

// Result of attempting a load. `source` is undefined on the failures the
// editor cannot open a document for (no manifest, unreadable folder);
// `error` is the user-facing message in that case. A broken FILE is not
// one of those — it loads, with its problem in the Console.
export interface LoadResult {
  source?: LoadedSource;
  error?: string;
}
