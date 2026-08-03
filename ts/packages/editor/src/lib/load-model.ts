import { MANIFEST_FILE, geometryPaths, normalizeRefPath as normalizePath, parseManifest, parsePaletteFile, resolveProject, resolveRefFrom, type Geometry, type InlineAnimation, type Manifest, type ResolvedPart } from '@cuboidy/core';
import { strFromU8, unzipSync } from 'fflate';
import type { LoadResult, LoadedSource } from './types.js';
const CUBOIDY_EXT = /\.cuboidy$/i;
// Package files worth reading as text. Referenced files are only ever
// .json (SPEC §8); .md/.txt ride along so docs survive a ZIP
// round-trip. Binary assets (images etc.) are skipped — reading them as
// text would garble them.
const TEXT_FILE_RE = /\.(json|md|txt)$/i;

// Public entry points. Each callsite knows what kind of source it has
// (single File, FileList from <input webkitdirectory>, FSA directory
// handle, or legacy FileSystemEntry from drag-drop on Firefox/Safari)
// and dispatches to the matching collector. All collectors now walk the
// WHOLE package (v0.7): every text file lands in a path-keyed map, and
// buildFolderResult resolves the manifest's references (geometry list,
// palette binding) from it.

// One loose file, read as the model's MANIFEST (SPEC §3: cuboidy.json is
// the anchor, and a lone geometry file is not a model). Since §6.13 a
// manifest can carry every part's geometry inline, so this is a complete
// model in one file — which is what the old bare-geometry path was
// reaching for, without the second-class document it produced.
//
// The file need not be *named* cuboidy.json: it is the manifest by virtue
// of being the thing handed to the loader, exactly as the folder's
// cuboidy.json is. It is stored under that name so every path-keyed
// reader sees the layout it expects.
export async function loadFromFile(file: File): Promise<LoadResult> {
  const text = await file.text();
  return buildFolderResult(
    new Map([[MANIFEST_FILE, text]]),
    file.name.replace(/\.json$/i, ''),
  );
}

// Single-file entrypoint that dispatches on extension. .cuboidy goes to
// the ZIP unpacker, anything else is read as a manifest.
export async function loadSingleFile(file: File): Promise<LoadResult> {
  if (CUBOIDY_EXT.test(file.name)) return loadFromCuboidyZip(file);
  return loadFromFile(file);
}

// Unpack a .cuboidy ZIP (the editor's own Export output, or any
// equivalent ZIP another tool produces). If every entry shares a single
// top-level folder (`wolf/voxels.json` style), that prefix is stripped
// so flat and folder-wrapped ZIPs load identically.
export async function loadFromCuboidyZip(file: File): Promise<LoadResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  // SPEC §13.4: bound the entry count and the total uncompressed size
  // BEFORE expanding. The bound used to be measured on the output of a
  // completed unzipSync, which is the one place it cannot help: by then
  // the bomb has already been expanded in memory. fflate's `filter` runs
  // per entry from the header, ahead of inflating that entry, so refusing
  // there is what actually stops it.
  let declared = 0;
  let count = 0;
  let refusal: string | null = null;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (refusal !== null) return false;
        if (++count > MAX_ZIP_ENTRIES) {
          refusal = `${file.name} has more than ${MAX_ZIP_ENTRIES} entries`;
          return false;
        }
        declared += f.originalSize;
        if (declared > MAX_ZIP_BYTES) {
          refusal =
            `${file.name} declares more than ` +
            `${Math.round(MAX_ZIP_BYTES / 1e6)} MB of uncompressed data`;
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    return {
      error: `Could not unpack ${file.name}: ${(e as Error).message}`,
    };
  }
  if (refusal !== null) return { error: refusal };
  const paths = Object.keys(entries).filter((p) => !p.endsWith('/'));

  // A header may lie about `originalSize`, so the same bound is re-checked
  // against what actually came out. The pre-check is what refuses a bomb;
  // this is what catches one that misdeclared itself.
  let actual = 0;
  for (const path of paths) actual += entries[path]!.length;
  if (actual > MAX_ZIP_BYTES) {
    return {
      error:
        `${file.name} expands to ${Math.round(actual / 1e6)} MB ` +
        `(limit ${Math.round(MAX_ZIP_BYTES / 1e6)} MB)`,
    };
  }

  // SPEC §13.2: reject rather than sanitise — judged on the name the
  // archive WROTE, before any prefix handling. Checking after the
  // common-top-directory strip let an archive whose every entry began
  // `../` straight through: `commonTopDir` saw `../` as the shared
  // prefix, removed it, and the check then inspected a clean name. The
  // traversal was sanitised away rather than refused, which is precisely
  // what §13.2 forbids.
  for (const path of paths) {
    if (!isSafeEntryPath(path)) {
      return { error: `${file.name}: unsafe entry path "${path}"` };
    }
  }

  const prefix = commonTopDir(paths);
  const files = new Map<string, string>();
  const assets = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  for (const path of paths) {
    const rel = prefix === null ? path : path.slice(prefix.length);
    const norm = normalizePath(rel);
    if (seen.has(norm)) {
      return { error: `${file.name}: duplicate entry "${norm}"` };
    }
    seen.add(norm);
    // SPEC §13.3: entries this reader does not understand are carried
    // through untouched, so open-and-save cannot quietly drop a
    // thumbnail or a licence.
    if (TEXT_FILE_RE.test(rel)) files.set(norm, strFromU8(entries[path]!));
    else assets.set(norm, entries[path]!);
  }
  return buildFolderResult(files, file.name.replace(CUBOIDY_EXT, ''), {
    ...(assets.size > 0 && { assets }),
  });
}

// SPEC §13.4 expansion bounds. Generous next to any real model — the
// largest shipped package is a few tens of kB — and small enough that a
// bomb is refused rather than expanded.
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;

// SPEC §13.2: `/`-separated, relative, no traversal, no backslash.
export function isSafeEntryPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false; // drive-letter absolute
  return !path.split('/').includes('..');
}

export async function loadFromFileList(files: FileList): Promise<LoadResult> {
  // <input webkitdirectory> populates File.webkitRelativePath with the
  // sub-path inside the picked folder, e.g. "wolf/voxels.json". The
  // first path segment is the folder itself.
  const map = new Map<string, string>();
  let folderName = 'folder';
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    // `||`, not `??`: the DOM always DEFINES webkitRelativePath, using the
    // empty string for a File that did not come from a directory picker.
    // `??` would pass that "" straight through and every path would then
    // fail TEXT_FILE_RE, silently collecting nothing.
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    let inner = rel;
    if (parts.length > 1) {
      folderName = parts[0]!;
      inner = parts.slice(1).join('/');
    }
    if (TEXT_FILE_RE.test(inner)) {
      map.set(normalizePath(inner), await f.text());
    }
  }
  return buildFolderResult(map, folderName);
}

export async function loadFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<LoadResult> {
  const map = new Map<string, string>();
  await collectHandle(handle, '', map);
  return buildFolderResult(map, handle.name, { handle });
}

async function collectHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Map<string, string>,
): Promise<void> {
  for await (const entry of dir.values()) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      await collectHandle(entry as FileSystemDirectoryHandle, path, out);
    } else if (TEXT_FILE_RE.test(entry.name)) {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.set(path, await file.text());
    }
  }
}

export async function loadFromDirectoryEntry(
  entry: FileSystemDirectoryEntry,
): Promise<LoadResult> {
  const map = new Map<string, string>();
  await collectEntry(entry, '', map);
  return buildFolderResult(map, entry.name);
}

async function collectEntry(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: Map<string, string>,
): Promise<void> {
  const entries = await readAllEntries(dir.createReader());
  for (const e of entries) {
    const path = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory) {
      await collectEntry(e as FileSystemDirectoryEntry, path, out);
    } else if (e.isFile && TEXT_FILE_RE.test(e.name)) {
      const file = await fileFromEntry(e as FileSystemFileEntry);
      out.set(path, await file.text());
    }
  }
}

// ── shared assembly ──────────────────────────────────────────────────

// Package assembly: resolve the manifest's references against the
// collected file map. The PRIMARY geometry file (the first one the model
// reads) is the file the geometry panel edits; the rest are parsed into
// `geometries`, and load problems land in `projectErrors` (shown in the
// Console panel). A model may have no geometry file at all — see §6.13.
function buildFolderResult(
  fileTexts: Map<string, string>,
  folderName: string,
  opts: {
    handle?: FileSystemDirectoryHandle;
    assets?: ReadonlyMap<string, Uint8Array>;
  } = {},
): LoadResult {
  // SPEC §3: the manifest is the package's anchor and is REQUIRED. Its
  // absence is not a model with problems, it is not a model — so it fails
  // the load outright rather than opening a document half the editor's
  // features are switched off for. (This used to be tolerated, producing
  // a second-class package with no rig view, no animation view and a
  // "Create manifest" promotion step. Inline geometry now covers the case
  // that leniency served: one file, complete model.)
  const manifestText = fileTexts.get(MANIFEST_FILE);
  if (manifestText === undefined) {
    return {
      error:
        `No ${MANIFEST_FILE} in '${folderName}'. Every Cuboidy model is ` +
        `anchored by its manifest (SPEC §3); a lone geometry file is not a ` +
        `model. Open a folder containing one, or a single ${MANIFEST_FILE}.`,
    };
  }
  // A manifest that is PRESENT but broken still loads: the point of the
  // editor is to fix it, and its text has to be on screen to be fixed.
  let manifest: Manifest | undefined;
  let manifestError: string | undefined;
  try {
    const json: unknown = JSON.parse(manifestText);
    const mR = parseManifest(json);
    if (mR.ok) manifest = mR.value;
    else manifestError = mR.message;
  } catch (e) {
    manifestError = `JSON parse: ${(e as Error).message}`;
  }

  // SPEC §6.9 + §6.13: which geometry FILES this model has, if any. An
  // all-inline manifest has none — and `geometryPaths` is what stops the
  // ["voxels.json"] default being demanded from one.
  //
  // With an UNPARSEABLE manifest there is nothing to ask: what it
  // references is exactly what could not be read. Guessing the old
  // `["voxels.json"]` default would refuse to open a one-file model over a
  // typo in it — the moment the editor is most needed. So: no geometry
  // files, the manifest error on screen, and everything re-resolves the
  // instant the text parses again.
  const geometryRefs = (
    manifest !== undefined ? geometryPaths(manifest) : []
  ).map(normalizePath);
  // The file the geometry panel edits by DEFAULT: the first referenced
  // geometry file that is actually present. A UI default and nothing
  // more — the SPEC has no primary geometry (the manifest is the only
  // fixed name, §3), so a missing or unparseable geometry file, first
  // in the list or not, is a per-file diagnostic from resolveProjectRefs
  // like any other, never a load failure. Absent when the model has no
  // geometry file at all (§6.13, every shape inline).
  const primary: string | undefined = geometryRefs.find((p) =>
    fileTexts.has(p),
  );

  const refs = resolveProjectRefs(manifest, fileTexts);
  const { geometries, externalAnims, projectErrors } = refs;

  const source: LoadedSource = {
    folderName,
    ...(opts.handle !== undefined && { handle: opts.handle }),
    files: new Map(fileTexts),
    ...(opts.assets !== undefined && { assets: opts.assets }),
    ...(primary !== undefined && { primaryPath: primary }),
    parts: refs.parts,
    manifestPath: MANIFEST_FILE,
    ...(manifest !== undefined && { manifest }),
    ...(manifestError !== undefined && { manifestError }),
    geometries,
    ...(externalAnims !== undefined && { externalAnims }),
    ...(projectErrors.length > 0 && { projectErrors }),
  };
  return { source };
}

// ── reference resolution ─────────────────────────────────────────────

export interface ResolvedProjectRefs {
  // Geometry ASTs — including the primary's entry, so callers replacing
  // the live geometry should read it back from here. A file that declared a
  // §7.4 palette REFERENCE has had it resolved: `palette` holds the colors
  // and `paletteRef` records where they came from.
  geometries: Map<string, Geometry>;
  // SPEC §6.13: every manifest part bound to its shape by the same core
  // routine the CLIs use, so the editor and they agree about what a part
  // IS — including one reached under a different name, or shared.
  parts: Map<string, ResolvedPart>;
  externalAnims?: Map<string, { path: string; anim: InlineAnimation }>;
  projectErrors: Array<{ file: string; message: string }>;
}

// A geometry file that points at a palette (§7.4) carries only the reference
// after parsing — resolving it needs the package around the file. Everywhere
// the editor (re)parses a geometry AST runs it through here, so a live-edited
// file renders the same colors the loader produced.
export function withResolvedPalette(
  geometry: Geometry,
  getText: (path: string) => string | undefined,
  // The geometry file's own path. SPEC §8 resolves a reference against
  // the file that WROTE it, so `gear/body.json` naming `palette.json`
  // means `gear/palette.json`.
  fromFile: string,
): Geometry {
  if (geometry.paletteRef === undefined) return geometry;
  const text = getText(resolveRefFrom(fromFile, geometry.paletteRef));
  if (text === undefined) return geometry;
  try {
    const r = parsePaletteFile(JSON.parse(text));
    if (r.ok) return { ...geometry, palette: r.value };
  } catch {
    // Unresolvable — the palette stays empty and the Console explains why.
  }
  return geometry;
}

// Resolve the manifest's references — geometry list, §6.10 palette
// binding, §6.3 animation string refs — against the package's current
// file texts. Pure; used by the loader AND by the editor's manifest
// re-parse, so the derived maps never go stale when cuboidy.json is
// edited directly. `primary` is the live-edited geometry (its in-memory
// AST wins over its file-map snapshot).
//
// A thin adapter over core's resolveProject — this used to be a ~115-line
// second implementation of the same walk, and the two had already begun
// to drift. The editor's only additions are the shape of the error list
// and friendlier wording for a `../` ref.
export function resolveProjectRefs(
  manifest: Manifest | undefined,
  files: ReadonlyMap<string, string>,
  // ABSENT for an all-inline model (§6.13): there is no geometry file, so
  // there is no primary one to hold live-edited text for.
  primary?: { path: string; geometry: Geometry },
): ResolvedProjectRefs {
  // No manifest, nothing to resolve: what it references is exactly what
  // could not be read. Only the live primary itself survives.
  if (manifest === undefined) {
    const geometries = new Map<string, Geometry>();
    if (primary !== undefined) geometries.set(primary.path, primary.geometry);
    return { geometries, parts: new Map<string, ResolvedPart>(), projectErrors: [] };
  }
  const r = resolveProject(manifest, files, {
    ...(primary !== undefined && {
      overrides: new Map([[primary.path, primary.geometry]]),
    }),
  });
  const geometries = new Map(r.geometries.map((g) => [g.path, g.geometry]));
  const projectErrors = r.diagnostics.map((d) => ({
    file: d.file,
    // §8 allows `../` in principle; this app does not load anything
    // outside the picked folder, so say that instead of "cannot read".
    message: d.file.startsWith('../')
      ? 'outside the package — workspace references are not supported yet'
      : d.diag.message,
  }));
  return {
    geometries,
    parts: r.parts,
    ...(r.externalAnims.size > 0 && { externalAnims: r.externalAnims }),
    projectErrors,
  };
}

// ── path helpers ─────────────────────────────────────────────────────

// Minimal posix-style normalize for SPEC §8 reference paths and package
// file paths: resolves `.` / `..` segments and collapses empty ones.
// Leading `..` segments are preserved (they mean "outside the package").
// The extension no longer says what a file is: geometry, the manifest, the
// palette binding and animation clips are all `.json` now. The manifest is the
// authority — a path is geometry when the model references it as geometry (or
// is the primary geometry file, which stands in for an absent manifest).
export function isGeometryPath(
  path: string,
  // Absent when the model has no geometry file at all (§6.13 all-inline).
  primaryName: string | undefined,
  manifest: Manifest | undefined,
): boolean {
  const norm = normalizePath(path);
  if (primaryName !== undefined && norm === normalizePath(primaryName)) return true;
  if (manifest === undefined) return false;
  // §6.13: a file may be referenced only by a part's `geometry.path`, so
  // the top-level list alone no longer answers this.
  return geometryPaths(manifest).some((ref) => normalizePath(ref) === norm);
}

// Core's §8 normalizer, re-exported under the name the editor has always
// used — the implementation lived here as a byte-identical copy until it
// was deduplicated.
export { normalizePath };

// If every path shares one top-level directory, returns `"<dir>/"`;
// otherwise null. Used to unwrap folder-wrapped ZIPs.
function commonTopDir(paths: string[]): string | null {
  let dir: string | null = null;
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i <= 0) return null;
    const top = p.slice(0, i + 1);
    if (dir === null) dir = top;
    else if (dir !== top) return null;
  }
  return dir;
}

// FileSystemDirectoryReader returns entries in batches and must be
// pumped until it returns an empty array. Old API, but Firefox/Safari
// still use this for drag-drop folders (no FSA equivalent there).
function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out);
        else {
          out.push(...batch);
          pump();
        }
      }, reject);
    };
    pump();
  });
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
