import { parseCvox, parseManifest, type Manifest } from '@cuboidy/core';
import { strFromU8, unzipSync } from 'fflate';
import type { FileEntry, LoadResult, LoadedSource } from './types.js';

const CVOX_FILE = 'voxels.cvox';
const MANIFEST_FILE = 'cuboidy.json';
const CUBOIDY_EXT = /\.cuboidy$/i;

// Public entry points. Each callsite knows what kind of source it has
// (single File, FileList from <input webkitdirectory>, FSA directory
// handle, or legacy FileSystemEntry from drag-drop on Firefox/Safari)
// and dispatches to the matching collector. All paths converge on
// buildResult so parsing / inline-comment counting / state shape are
// uniform regardless of how the bytes arrived.

export async function loadFromFile(file: File): Promise<LoadResult> {
  const text = await file.text();
  return buildResult({ cvoxName: file.name, cvoxText: text });
}

// Single-file entrypoint that dispatches on extension. .cuboidy goes to
// the ZIP unpacker, anything else is treated as a raw .cvox text file.
// Use this from drop / pick handlers so they don't have to know about
// extensions themselves.
export async function loadSingleFile(file: File): Promise<LoadResult> {
  if (CUBOIDY_EXT.test(file.name)) return loadFromCuboidyZip(file);
  return loadFromFile(file);
}

// Unpack a .cuboidy ZIP (the editor's own Export → Download as .cuboidy
// output, or any equivalent ZIP another tool produces). Looks up the
// canonical filenames by *basename* so both flat ZIPs (our exports) and
// folder-wrapped ZIPs (`wolf/voxels.cvox` style) load identically. The
// .cuboidy file name (sans extension) becomes the folder name in the
// loaded source — synthetic = false since it came from a real file.
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
  let cvoxText: string | undefined;
  let manifestText: string | undefined;
  for (const [path, data] of Object.entries(entries)) {
    const name = basename(path);
    if (name === CVOX_FILE && cvoxText === undefined) {
      cvoxText = strFromU8(data);
    } else if (name === MANIFEST_FILE && manifestText === undefined) {
      manifestText = strFromU8(data);
    }
  }
  if (cvoxText === undefined) {
    return { error: `No ${CVOX_FILE} in ${file.name}` };
  }
  return buildResult({
    cvoxName: CVOX_FILE,
    cvoxText,
    folderName: file.name.replace(CUBOIDY_EXT, ''),
    ...(manifestText !== undefined && {
      manifestName: MANIFEST_FILE,
      manifestText,
    }),
  });
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i === -1 ? path : path.slice(i + 1);
}

export async function loadFromFileList(files: FileList): Promise<LoadResult> {
  const raw = await collectFromFileList(files);
  if (raw === null) return { error: `No ${CVOX_FILE} in the selected folder` };
  return buildResult(raw);
}

export async function loadFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<LoadResult> {
  const raw = await collectFromDirectoryHandle(handle);
  if (raw === null) return { error: `No ${CVOX_FILE} in folder '${handle.name}'` };
  return buildResult(raw, { handle });
}

export async function loadFromDirectoryEntry(
  entry: FileSystemDirectoryEntry,
): Promise<LoadResult> {
  const raw = await collectFromDirectoryEntry(entry);
  if (raw === null) return { error: `No ${CVOX_FILE} in folder '${entry.name}'` };
  return buildResult(raw);
}

// ── shared assembly ──────────────────────────────────────────────────

interface RawCollected {
  cvoxName: string;
  cvoxText: string;
  manifestName?: string;
  manifestText?: string;
  folderName?: string;
}

function buildResult(
  raw: RawCollected,
  opts: { handle?: FileSystemDirectoryHandle } = {},
): LoadResult {
  const droppedInlineComments = countInlineComments(raw.cvoxText);
  const cvoxR = parseCvox(raw.cvoxText);
  if (!cvoxR.ok) {
    return { error: cvoxR.message, cvoxFileName: raw.cvoxName };
  }

  const cvoxFile: FileEntry = { name: raw.cvoxName, text: raw.cvoxText };

  // Single-file load (no folder context).
  if (raw.folderName === undefined) {
    const source: LoadedSource = {
      kind: 'cvox-only',
      cvox: cvoxR.value,
      cvoxFile,
      droppedInlineComments,
    };
    return { source, cvoxFileName: raw.cvoxName };
  }

  // Folder load — manifest may or may not be present.
  let manifest: Manifest | undefined;
  let manifestError: string | undefined;
  let manifestFile: FileEntry | undefined;
  if (raw.manifestText !== undefined && raw.manifestName !== undefined) {
    manifestFile = { name: raw.manifestName, text: raw.manifestText };
    try {
      const json: unknown = JSON.parse(raw.manifestText);
      const mR = parseManifest(json);
      if (mR.ok) manifest = mR.value;
      else manifestError = mR.message;
    } catch (e) {
      manifestError = `JSON parse: ${(e as Error).message}`;
    }
  }

  const source: LoadedSource = {
    kind: 'folder',
    folderName: raw.folderName,
    synthetic: false,
    ...(opts.handle !== undefined && { handle: opts.handle }),
    cvox: cvoxR.value,
    cvoxFile,
    ...(manifest !== undefined && { manifest }),
    ...(manifestFile !== undefined && { manifestFile }),
    ...(manifestError !== undefined && { manifestError }),
    droppedInlineComments,
  };
  return { source, cvoxFileName: raw.cvoxName };
}

// ── collectors per source ────────────────────────────────────────────

async function collectFromFileList(
  files: FileList,
): Promise<RawCollected | null> {
  // <input webkitdirectory> populates File.webkitRelativePath with the
  // sub-path inside the picked folder, e.g. "wolf/voxels.cvox". We use
  // the first path segment as the folder name.
  let cvoxFile: File | null = null;
  let manifestFile: File | null = null;
  let folderName = 'folder';
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
    const parts = rel.split('/');
    if (parts.length > 1) folderName = parts[0]!;
    const baseName = parts[parts.length - 1]!;
    if (baseName === CVOX_FILE && cvoxFile === null) cvoxFile = f;
    else if (baseName === MANIFEST_FILE && manifestFile === null) manifestFile = f;
  }
  if (cvoxFile === null) return null;
  return {
    cvoxName: cvoxFile.name,
    cvoxText: await cvoxFile.text(),
    folderName,
    ...(manifestFile !== null && {
      manifestName: manifestFile.name,
      manifestText: await manifestFile.text(),
    }),
  };
}

async function collectFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<RawCollected | null> {
  let cvoxFile: File | null = null;
  let manifestFile: File | null = null;
  // FileSystemDirectoryHandle.values() is async-iterable. Children are
  // FileSystemHandle (kind = 'file' | 'directory'). We currently look
  // only at top-level files; anims/ subdirectory is a future task.
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    if (entry.name === CVOX_FILE) cvoxFile = await entry.getFile();
    else if (entry.name === MANIFEST_FILE) manifestFile = await entry.getFile();
  }
  if (cvoxFile === null) return null;
  return {
    cvoxName: cvoxFile.name,
    cvoxText: await cvoxFile.text(),
    folderName: handle.name,
    ...(manifestFile !== null && {
      manifestName: manifestFile.name,
      manifestText: await manifestFile.text(),
    }),
  };
}

async function collectFromDirectoryEntry(
  entry: FileSystemDirectoryEntry,
): Promise<RawCollected | null> {
  const reader = entry.createReader();
  const entries = await readAllEntries(reader);
  let cvoxFile: File | null = null;
  let manifestFile: File | null = null;
  for (const e of entries) {
    if (!e.isFile) continue;
    if (e.name === CVOX_FILE) cvoxFile = await fileFromEntry(e as FileSystemFileEntry);
    else if (e.name === MANIFEST_FILE)
      manifestFile = await fileFromEntry(e as FileSystemFileEntry);
  }
  if (cvoxFile === null) return null;
  return {
    cvoxName: cvoxFile.name,
    cvoxText: await cvoxFile.text(),
    folderName: entry.name,
    ...(manifestFile !== null && {
      manifestName: manifestFile.name,
      manifestText: await manifestFile.text(),
    }),
  };
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

// Counts inline `//` occurrences (anything after the file header) so the
// editor can surface a warning that they won't be preserved on save.
// SPEC v0.6 §7.11.1: only the file header round-trips.
function countInlineComments(text: string): number {
  const lines = text.split(/\r?\n/);
  let inHeader = true;
  let inlineCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inHeader) {
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith('//')) continue;
      inHeader = false;
    }
    if (line.includes('//')) inlineCount++;
  }
  return inlineCount;
}
