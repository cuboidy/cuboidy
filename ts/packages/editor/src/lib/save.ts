import { downloadBlob, downloadText, ensureReadwritePermission, removeFileAt, writeTextFileAt } from '@cuboidy/ui';
import { strToU8, zip, type Zippable } from 'fflate';
import type { LoadedSource } from './types.js';

// Persistence layer. Three export paths exist:
//
//   1. saveToFolder — FSA writeback to the original folder. Requires
//      a FileSystemDirectoryHandle (only acquired by FSA-aware drop or
//      showDirectoryPicker on Chrome/Edge). Requests readwrite
//      permission the first time it's called for a given handle.
//   2. downloadFile — single-file download via <a download>. Works in
//      every browser.
//   3. downloadAsZip — bundle the whole package into a `.cuboidy` ZIP,
//      then download. Works in every browser; the only viable path on
//      FF/Safari and on synthetic folders.
//
// The browser plumbing under all three — the permission prompt, the
// nested-path write, the <a download> — is @cuboidy/ui/fs; what stays
// here is what makes it a PACKAGE save. Everything takes text and writes
// text: `source.files` is the single store, kept current by the edit
// layer, so save is a plain walk over it.

export async function saveToFolder(
  source: LoadedSource,
): Promise<void> {
  if (source.handle === undefined) {
    throw new Error('No folder handle — cannot save in place');
  }
  await ensureReadwritePermission(source.handle);
  // Whole package: `files` holds every file including the primary
  // geometry and the manifest, so there is nothing to override.
  const files = source.files;
  for (const [path, text] of files) {
    await writeTextFileAt(source.handle, path, text);
  }
  // Files deleted / renamed away in the editor. Already-gone entries are
  // fine (a second save after a successful delete is a no-op).
  for (const path of source.removedFiles ?? []) {
    if (files.has(path)) continue; // defensive: never delete a live path
    await removeFileAt(source.handle, path);
  }
}

export function downloadFile(name: string, text: string): void {
  downloadText(name, text);
}

// What Export puts in the archive: every file collected at load, so extra
// geometry files, palette.json and anims/ survive the round trip — AND the
// entries the editor never understood (SPEC §13.3), byte for byte. Dropping
// those would make "open and export" quietly lossy, which is exactly what it
// used to be. Split out from downloadAsZip so the round trip is testable
// without a browser download.
export function packageEntries(source: LoadedSource): Zippable {
  const files: Zippable = {};
  for (const [path, text] of source.files) files[path] = strToU8(text);
  for (const [path, bytes] of source.assets ?? []) files[path] = bytes;
  return files;
}

export async function downloadAsZip(
  source: LoadedSource,
  zipName: string,
): Promise<void> {
  const bytes = await zipAsync(packageEntries(source));
  // fflate returns `Uint8Array<ArrayBufferLike>`; lib.dom's Blob ctor
  // wants `BufferSource` (which excludes SharedArrayBuffer-backed views).
  // Cast through BlobPart — the value is always a plain Uint8Array at
  // runtime, the looseness is only in the type.
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  downloadBlob(blob, zipName);
}

// ── helpers ──────────────────────────────────────────────────────────

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
