import { strToU8, zip, type Zippable } from 'fflate';
import type { LoadedSource } from './types.js';

// FSA permission API not yet present in lib.dom (as of the TypeScript
// version used here). The methods exist on every Chromium ≥86 build, so
// we augment the standard interface with the call signatures we use.
// When lib.dom catches up this declare can be removed without changes
// at callsites.
declare global {
  interface FileSystemHandle {
    queryPermission(desc?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
    requestPermission(desc?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
  }
}

// Persistence layer. Three export paths exist:
//
//   1. saveToFolder — FSA writeback to the original folder. Requires
//      a FileSystemDirectoryHandle (only acquired by FSA-aware drop or
//      showDirectoryPicker on Chrome/Edge). Requests readwrite
//      permission the first time it's called for a given handle.
//   2. downloadFile — single-file download via <a download>. Works in
//      every browser.
//   3. downloadAsZip — bundle voxels.cvox (+ cuboidy.json if present)
//      into a `.cuboidy` ZIP, then download. Works in every browser;
//      the only viable path on FF/Safari and on synthetic folders.
//
// Pre-edit phase note: until the editor mutates the loaded AST, save
// just round-trips the original text bytes. When edits land, the
// dirty-tracking layer will swap `source.cvoxFile.text` for a fresh
// serialize. This file doesn't need to change at that point — it
// already takes text and writes text.

export async function saveToFolder(
  source: Extract<LoadedSource, { kind: 'folder' }>,
): Promise<void> {
  if (source.handle === undefined) {
    throw new Error('No folder handle — cannot save in place');
  }
  await ensureReadwritePermission(source.handle);
  // Whole package (v0.7): every collected file, with the live-edited
  // pair overriding their load-time snapshots.
  const files = new Map<string, string>();
  if (source.files !== undefined) {
    for (const [path, entry] of source.files) files.set(path, entry.text);
  }
  files.set(source.cvoxFile.name, source.cvoxFile.text);
  if (source.manifestFile !== undefined) {
    files.set(source.manifestFile.name, source.manifestFile.text);
  }
  for (const [path, text] of files) {
    await writeTextFile(source.handle, path, text);
  }
  // Files deleted / renamed away in the editor. Already-gone entries are
  // fine (a second save after a successful delete is a no-op).
  for (const path of source.removedFiles ?? []) {
    if (files.has(path)) continue; // defensive: never delete a live path
    await removeFile(source.handle, path);
  }
}

export function downloadFile(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, name);
}

export async function downloadAsZip(
  source: Extract<LoadedSource, { kind: 'folder' }>,
  zipName: string,
): Promise<void> {
  // Whole package (v0.7): every file collected at load, with the two
  // live-edited files overriding their load-time snapshots — so extra
  // geometry files, palette.json and anims/ survive the round-trip.
  const files: Zippable = {};
  if (source.files !== undefined) {
    for (const [path, entry] of source.files) {
      files[path] = strToU8(entry.text);
    }
  }
  files[source.cvoxFile.name] = strToU8(source.cvoxFile.text);
  if (source.manifestFile !== undefined) {
    files[source.manifestFile.name] = strToU8(source.manifestFile.text);
  }
  const bytes = await zipAsync(files);
  // fflate returns `Uint8Array<ArrayBufferLike>`; lib.dom's Blob ctor
  // wants `BufferSource` (which excludes SharedArrayBuffer-backed views).
  // Cast through BlobPart — the value is always a plain Uint8Array at
  // runtime, the looseness is only in the type.
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  triggerDownload(blob, zipName);
}

// ── helpers ──────────────────────────────────────────────────────────

async function ensureReadwritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const desc = { mode: 'readwrite' as const };
  const existing = await handle.queryPermission(desc);
  if (existing === 'granted') return;
  const requested = await handle.requestPermission(desc);
  if (requested !== 'granted') {
    throw new Error(
      'Folder write permission was denied. The browser will not let the editor save in place.',
    );
  }
}

// `name` may be a /-separated sub-path (v0.7 geometry refs like
// `gear/hat.cvox`) — intermediate directories are created as needed.
async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const segments = name.split('/');
  const base = segments.pop()!;
  let target = dir;
  for (const seg of segments) {
    target = await target.getDirectoryHandle(seg, { create: true });
  }
  const fileHandle = await target.getFileHandle(base, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

async function removeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const segments = name.split('/');
  const base = segments.pop()!;
  let target = dir;
  try {
    for (const seg of segments) {
      target = await target.getDirectoryHandle(seg);
    }
    await target.removeEntry(base);
  } catch {
    // Not found (already deleted on a previous save) — nothing to do.
  }
}

// fflate's `zip` is callback-style. Wrap in a Promise so callers can
// await it like every other async function in this module.
function zipAsync(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the click has a chance to start downloading;
  // some browsers race the revoke against the navigation in older builds.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
