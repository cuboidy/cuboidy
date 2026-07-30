import {
  InlineAnimationSchema,
  manifestGeometry,
  parseGeometryText,
  parseManifest,
  parsePaletteFile,
  type Geometry,
  type InlineAnimation,
  type Manifest,
  type Palette,
} from '@cuboidy/core';
import { strFromU8, unzipSync } from 'fflate';
import type { FileEntry, LoadResult, LoadedSource } from './types.js';

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
  const prefix = commonTopDir(paths);
  const files = new Map<string, string>();
  for (const path of paths) {
    const rel = prefix === null ? path : path.slice(prefix.length);
    if (TEXT_FILE_RE.test(rel)) {
      files.set(normalizePath(rel), strFromU8(entries[path]!));
    }
  }
  return buildFolderResult(files, file.name.replace(CUBOIDY_EXT, ''));
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
    geometry: geometryR.value,
    geometryFile: { name, text },
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
  opts: { handle?: FileSystemDirectoryHandle } = {},
): LoadResult {
  // Manifest first — the geometry list depends on it.
  let manifest: Manifest | undefined;
  let manifestError: string | undefined;
  let manifestFile: FileEntry | undefined;
  const manifestText = fileTexts.get(MANIFEST_FILE);
  if (manifestText !== undefined) {
    manifestFile = { name: MANIFEST_FILE, text: manifestText };
    try {
      const json: unknown = JSON.parse(manifestText);
      const mR = parseManifest(json);
      if (mR.ok) manifest = mR.value;
      else manifestError = mR.message;
    } catch (e) {
      manifestError = `JSON parse: ${(e as Error).message}`;
    }
  }

  const geometryRefs = (
    manifest !== undefined ? manifestGeometry(manifest) : [GEOMETRY_FILE]
  ).map(normalizePath);
  const primary = geometryRefs[0]!;
  const primaryText = fileTexts.get(primary);
  if (primaryText === undefined) {
    return { error: `No ${primary} in folder '${folderName}'` };
  }

  const geometryR = parseGeometryText(primaryText);
  if (!geometryR.ok) {
    return { error: geometryR.message, geometryFileName: primary };
  }

  const refs = resolveProjectRefs(manifest, (p) => fileTexts.get(p), {
    path: primary,
    geometry: geometryR.value,
  });
  const { geometries, externalPalette, externalAnims, projectErrors } = refs;
  const resolvedPrimary = geometries.get(primary) ?? geometryR.value;

  const files = new Map<string, FileEntry>();
  for (const [path, text] of fileTexts) {
    files.set(path, { name: path, text });
  }

  const source: LoadedSource = {
    folderName,
    synthetic: false,
    ...(opts.handle !== undefined && { handle: opts.handle }),
    geometry: resolvedPrimary,
    geometryFile: { name: primary, text: primaryText },
    ...(manifest !== undefined && { manifest }),
    ...(manifestFile !== undefined && { manifestFile }),
    ...(manifestError !== undefined && { manifestError }),
    files,
    geometries,
    ...(externalPalette !== undefined && { externalPalette }),
    ...(externalAnims !== undefined && { externalAnims }),
    ...(projectErrors.length > 0 && { projectErrors }),
  };
  return { source, geometryFileName: primary };
}

// ── reference resolution ─────────────────────────────────────────────

export interface ResolvedProjectRefs {
  // Geometry ASTs — including the primary's entry, so callers replacing
  // the live geometry should read it back from here.
  geometries: Map<string, Geometry>;
  externalPalette?: Palette;
  externalAnims?: Map<string, { path: string; anim: InlineAnimation }>;
  projectErrors: Array<{ file: string; message: string }>;
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
  primary: { path: string; geometry: Geometry },
): ResolvedProjectRefs {
  const projectErrors: Array<{ file: string; message: string }> = [];
  const geometries = new Map<string, Geometry>();

  const geometryRefs = (
    manifest !== undefined ? manifestGeometry(manifest) : [primary.path]
  ).map(normalizePath);
  for (const ref of geometryRefs) {
    if (ref === primary.path) {
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

  let externalPalette: Palette | undefined;
  if (manifest?.palette !== undefined) {
    const ref = normalizePath(manifest.palette);
    const text = getText(ref);
    if (text === undefined) {
      projectErrors.push({
        file: ref,
        message: ref.startsWith('../')
          ? 'outside the package — workspace references are not supported yet'
          : 'referenced as the manifest palette but not found',
      });
    } else {
      try {
        const pR = parsePaletteFile(JSON.parse(text));
        if (pR.ok) externalPalette = pR.value;
        else projectErrors.push({ file: ref, message: pR.message });
      } catch (e) {
        projectErrors.push({
          file: ref,
          message: `JSON parse: ${(e as Error).message}`,
        });
      }
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
    ...(externalPalette !== undefined && { externalPalette }),
    ...(externalAnims.size > 0 && { externalAnims }),
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
  primaryName: string,
  manifest: Manifest | undefined,
): boolean {
  const norm = normalizePath(path);
  if (norm === normalizePath(primaryName)) return true;
  if (manifest === undefined) return false;
  return manifestGeometry(manifest).some((ref) => normalizePath(ref) === norm);
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
