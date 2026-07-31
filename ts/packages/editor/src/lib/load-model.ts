import {
  InlineAnimationSchema,
  geometryPaths,
  manifestGeometry,
  parseGeometryText,
  parseManifest,
  parsePaletteFile,
  resolvePartGeometry,
  type Geometry,
  type InlineAnimation,
  type Manifest,
  type Palette,
  type Part,
} from '@cuboidy/core';
import { strFromU8, unzipSync } from 'fflate';
import type { LoadResult, LoadedSource } from './types.js';

const GEOMETRY_FILE = 'voxels.json';
const MANIFEST_FILE = 'cuboidy.json';
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

export async function loadFromFile(file: File): Promise<LoadResult> {
  const text = await file.text();
  return buildGeometryOnlyResult(file.name, text);
}

// Single-file entrypoint that dispatches on extension. .cuboidy goes to
// the ZIP unpacker, anything else is treated as a raw geometry file.
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
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    return {
      error: `Could not unpack ${file.name}: ${(e as Error).message}`,
    };
  }
  const paths = Object.keys(entries).filter((p) => !p.endsWith('/'));

  // SPEC §13.4: bound the expansion before trusting it. An archive is a
  // hostile input and a few kB of ZIP can name gigabytes of output.
  let total = 0;
  for (const path of paths) total += entries[path]!.length;
  if (paths.length > MAX_ZIP_ENTRIES) {
    return { error: `${file.name} has ${paths.length} entries (limit ${MAX_ZIP_ENTRIES})` };
  }
  if (total > MAX_ZIP_BYTES) {
    return {
      error:
        `${file.name} expands to ${Math.round(total / 1e6)} MB ` +
        `(limit ${Math.round(MAX_ZIP_BYTES / 1e6)} MB)`,
    };
  }

  const prefix = commonTopDir(paths);
  const files = new Map<string, string>();
  const assets = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  for (const path of paths) {
    const rel = prefix === null ? path : path.slice(prefix.length);
    // SPEC §13.2: reject rather than sanitise. A cleaned-up `../` is
    // silently a different file from the one the archive named.
    if (!isSafeEntryPath(rel)) {
      return { error: `${file.name}: unsafe entry path "${rel}"` };
    }
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

function buildGeometryOnlyResult(name: string, text: string): LoadResult {
  const geometryR = parseGeometryText(text);
  if (!geometryR.ok) {
    return { error: geometryR.message, geometryFileName: name };
  }
  // No folderName: this is a lone file, not a package (see LoadedSource).
  const source: LoadedSource = {
    synthetic: false,
    files: new Map([[name, text]]),
    primaryPath: name,
    geometries: new Map([[name, geometryR.value]]),
  };
  return { source, geometryFileName: name };
}

// Folder assembly (v0.7): resolve the manifest's references against the
// collected file map. The PRIMARY geometry file (first `geometry` entry,
// default voxels.json) plays the pre-v0.7 single-geometry role — it is the
// file the editor edits; the rest are parsed into `geometries` and load
// problems land in `projectErrors` (shown in the Console panel).
function buildFolderResult(
  fileTexts: Map<string, string>,
  folderName: string,
  opts: {
    handle?: FileSystemDirectoryHandle;
    assets?: ReadonlyMap<string, Uint8Array>;
  } = {},
): LoadResult {
  // Manifest first — the geometry list depends on it.
  let manifest: Manifest | undefined;
  let manifestError: string | undefined;
  const manifestText = fileTexts.get(MANIFEST_FILE);
  if (manifestText !== undefined) {
    try {
      const json: unknown = JSON.parse(manifestText);
      const mR = parseManifest(json);
      if (mR.ok) manifest = mR.value;
      else manifestError = mR.message;
    } catch (e) {
      manifestError = `JSON parse: ${(e as Error).message}`;
    }
  }

  // SPEC §6.9 + §6.13: which geometry FILES this model has, if any. An
  // all-inline manifest has none — and `geometryPaths` is what stops the
  // ["voxels.json"] default being demanded from one.
  const geometryRefs = (
    manifest !== undefined ? geometryPaths(manifest) : [GEOMETRY_FILE]
  ).map(normalizePath);
  const primary: string | undefined = geometryRefs[0];

  // The primary is loaded eagerly (a parse failure here fails the whole
  // load) because it is the file the geometry panel edits and its AST must
  // exist for the panel to open. With no geometry file there is nothing to
  // do here: every part's shape is in the manifest.
  let primaryGeom: Geometry | undefined;
  if (primary !== undefined) {
    const primaryText = fileTexts.get(primary);
    if (primaryText === undefined) {
      return { error: `No ${primary} in folder '${folderName}'` };
    }
    const geometryR = parseGeometryText(primaryText);
    if (!geometryR.ok) {
      return { error: geometryR.message, geometryFileName: primary };
    }
    primaryGeom = geometryR.value;
  }

  const refs = resolveProjectRefs(
    manifest,
    (p) => fileTexts.get(p),
    primary !== undefined && primaryGeom !== undefined
      ? { path: primary, geometry: primaryGeom }
      : undefined,
  );
  const { geometries, inlineParts, externalAnims, projectErrors } = refs;
  // The primary always resolves (its text parsed above), so the AST store
  // is complete for it even if a sibling ref failed.
  if (primary !== undefined && primaryGeom !== undefined && !geometries.has(primary)) {
    geometries.set(primary, primaryGeom);
  }

  const source: LoadedSource = {
    folderName,
    synthetic: false,
    ...(opts.handle !== undefined && { handle: opts.handle }),
    files: new Map(fileTexts),
    ...(opts.assets !== undefined && { assets: opts.assets }),
    ...(primary !== undefined && { primaryPath: primary }),
    ...(inlineParts.size > 0 && { inlineParts }),
    ...(manifestText !== undefined && { manifestPath: MANIFEST_FILE }),
    ...(manifest !== undefined && { manifest }),
    ...(manifestError !== undefined && { manifestError }),
    geometries,
    ...(externalAnims !== undefined && { externalAnims }),
    ...(projectErrors.length > 0 && { projectErrors }),
  };
  return { source, ...(primary !== undefined && { geometryFileName: primary }) };
}

// ── reference resolution ─────────────────────────────────────────────

export interface ResolvedProjectRefs {
  // Geometry ASTs — including the primary's entry, so callers replacing
  // the live geometry should read it back from here. A file that declared a
  // §7.4 palette REFERENCE has had it resolved: `palette` holds the colors
  // and `paletteRef` records where they came from.
  geometries: Map<string, Geometry>;
  // SPEC §6.13 parts written into the manifest, with their palette already
  // resolved by the same core routine the CLIs use.
  inlineParts: Map<string, { part: Part; palette: Palette }>;
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
): Geometry {
  if (geometry.paletteRef === undefined) return geometry;
  const text = getText(normalizePath(geometry.paletteRef));
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
// edited directly. `primary` is the live-edited geometry (its in-memory AST
// wins over its file-map snapshot).
export function resolveProjectRefs(
  manifest: Manifest | undefined,
  getText: (path: string) => string | undefined,
  // ABSENT for an all-inline model (§6.13): there is no geometry file, so
  // there is no primary one to hold live-edited text for.
  primary?: { path: string; geometry: Geometry },
): ResolvedProjectRefs {
  const projectErrors: Array<{ file: string; message: string }> = [];
  const geometries = new Map<string, Geometry>();

  // §6.9 + §6.13 via core, so the editor reads the same set of files the
  // CLIs do — including files reached only by a part-level `geometry.path`,
  // and NOT the ["voxels.json"] default when no part needs the by-name
  // lookup (which is what makes a one-file model loadable at all).
  const geometryRefs = (
    manifest !== undefined
      ? geometryPaths(manifest)
      : primary !== undefined
        ? [primary.path]
        : []
  ).map(normalizePath);
  for (const ref of geometryRefs) {
    if (primary !== undefined && ref === primary.path) {
      geometries.set(ref, primary.geometry);
      continue;
    }
    const text = getText(ref);
    if (text === undefined) {
      projectErrors.push({
        file: ref,
        message: ref.startsWith('../')
          ? 'outside the package — workspace references are not supported yet'
          : 'referenced by the manifest geometry list but not found',
      });
      continue;
    }
    const r = parseGeometryText(text);
    if (!r.ok) projectErrors.push({ file: ref, message: r.message });
    else geometries.set(ref, r.value);
  }

  // §7.4 palette references, resolved per geometry file and cached by path
  // so files sharing one palette read it once and report at most one error.
  const paletteCache = new Map<string, Palette | null>();
  for (const [path, geometry] of geometries) {
    if (geometry.paletteRef === undefined) continue;
    const ref = normalizePath(geometry.paletteRef);
    let palette = paletteCache.get(ref);
    if (palette === undefined) {
      palette = readPaletteRef(ref, getText, projectErrors);
      paletteCache.set(ref, palette);
    }
    if (palette !== null) geometries.set(path, { ...geometry, palette });
  }

  // §6.13 part binding, through core's resolver rather than a second
  // implementation here — the editor and the CLIs must agree about which
  // shape a part has and what colors it means. Only the inline results are
  // kept: a file-backed part is already reachable through `geometries`,
  // and storing it twice is the shadowing this shape exists to avoid.
  const inlineParts = new Map<string, { part: Part; palette: Palette }>();
  if (manifest !== undefined) {
    const bound = resolvePartGeometry(
      manifest,
      [...geometries].map(([path, geometry]) => ({ path, geometry })),
      (ref) => readPaletteRef(normalizePath(ref), getText, projectErrors),
    );
    for (const [name, r] of bound.parts) {
      if (r.file === null) inlineParts.set(name, { part: r.part, palette: r.palette });
    }
  }

  // External animations (§6.3 string refs): each references a JSON file
  // holding ONE inline-animation object. Resolved per clip name.
  const externalAnims = new Map<string, { path: string; anim: InlineAnimation }>();
  if (manifest?.animations !== undefined) {
    for (const [clip, anim] of Object.entries(manifest.animations)) {
      if (typeof anim !== 'string') continue;
      const ref = normalizePath(anim);
      const text = getText(ref);
      if (text === undefined) {
        projectErrors.push({
          file: ref,
          message: ref.startsWith('../')
            ? `animation '${clip}': outside the package — workspace references are not supported yet`
            : `animation '${clip}' references it, but it was not found`,
        });
        continue;
      }
      try {
        const parsed = InlineAnimationSchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          externalAnims.set(clip, { path: ref, anim: parsed.data });
        } else {
          const issue = parsed.error.issues[0]!;
          const at = issue.path.length > 0 ? issue.path.join('.') : '<root>';
          projectErrors.push({
            file: ref,
            message: `animation '${clip}': ${at}: ${issue.message}`,
          });
        }
      } catch (e) {
        projectErrors.push({
          file: ref,
          message: `JSON parse: ${(e as Error).message}`,
        });
      }
    }
  }

  return {
    geometries,
    inlineParts,
    ...(externalAnims.size > 0 && { externalAnims }),
    projectErrors,
  };
}

// Read + validate one referenced palette file (§6.10). null (plus a project
// error) when it is missing or malformed; the referring geometry then keeps
// its empty palette and cross-file lint explains the consequence.
function readPaletteRef(
  ref: string,
  getText: (path: string) => string | undefined,
  projectErrors: Array<{ file: string; message: string }>,
): Palette | null {
  const text = getText(ref);
  if (text === undefined) {
    projectErrors.push({
      file: ref,
      message: ref.startsWith('../')
        ? 'outside the package — workspace references are not supported yet'
        : 'referenced as a geometry palette but not found',
    });
    return null;
  }
  try {
    const r = parsePaletteFile(JSON.parse(text));
    if (r.ok) return r.value;
    projectErrors.push({ file: ref, message: r.message });
  } catch (e) {
    projectErrors.push({
      file: ref,
      message: `JSON parse: ${(e as Error).message}`,
    });
  }
  return null;
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

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

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
