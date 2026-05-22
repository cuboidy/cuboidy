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
  await writeTextFile(source.handle, source.cvoxFile.name, source.cvoxFile.text);
  if (source.manifestFile !== undefined) {
    await writeTextFile(
      source.handle,
      source.manifestFile.name,
      source.manifestFile.text,
    );
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
  const files: Zippable = {
    [source.cvoxFile.name]: strToU8(source.cvoxFile.text),
  };
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

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
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
