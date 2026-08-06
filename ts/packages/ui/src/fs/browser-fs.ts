// Reading and writing a folder from a browser, which both apps do and
// neither does differently.
//
// There are three ways in, because browsers disagree: the File System
// Access API (Chrome/Edge — the only one that yields a handle, and so the
// only one that can write back in place), the legacy `FileSystemEntry`
// a drag-and-drop still hands over, and `<input webkitdirectory>` with
// its `webkitRelativePath`. Every one of them was written twice.
//
// Non-React on purpose, and here rather than in core: core is also the
// CLIs' library and runs under Node, where none of this exists. `ui` is
// already the browser-only layer both apps depend on.

// FSA's permission methods are not in lib.dom yet (as of the TypeScript
// version used here) though every Chromium ≥86 has them. Augmenting the
// standard interface keeps callsites plain; when lib.dom catches up this
// block can go without touching them.
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

// What a Cuboidy package or scene library is made of. Everything else in
// a folder is either carried verbatim (the editor's §13.3 assets) or
// ignored (the workspace, which never writes a model back).
export const TEXT_FILE_RE = /\.(json|md|txt)$/i;

// ── reading ──────────────────────────────────────────────────────────

export function canUseDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// Ask the user for a folder. Throws `AbortError` when they cancel, which
// callers distinguish from a real failure.
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  return picker();
}

// Every text file under an FSA directory handle, keyed by its
// /-separated path relative to that directory.
export async function readDirectoryHandle(
  dir: FileSystemDirectoryHandle,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await collectHandle(dir, '', out);
  return out;
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

// The same, over the legacy drag-and-drop entry API — the read-only path
// Firefox and Safari leave us.
export async function readDirectoryEntry(
  dir: FileSystemDirectoryEntry,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await collectEntry(dir, '', out);
  return out;
}

async function collectEntry(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: Map<string, string>,
): Promise<void> {
  for (const e of await readAllEntries(dir.createReader())) {
    const path = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory) {
      await collectEntry(e as FileSystemDirectoryEntry, path, out);
    } else if (e.isFile && TEXT_FILE_RE.test(e.name)) {
      const file = await fileFromEntry(e as FileSystemFileEntry);
      out.set(path, await file.text());
    }
  }
}

// readEntries returns at most 100 per call and signals the end with an
// empty batch, so it has to be drained in a loop.
async function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// One entry of an `<input webkitdirectory>` pick: the folder it came
// from, and its path INSIDE that folder.
export interface PickedFile {
  // The first path segment — the picked folder's own name. Undefined for
  // a file that did not come from a directory pick, which has no folder.
  folderName?: string;
  // The path relative to `folderName`, or the bare filename when there
  // is none.
  path: string;
  text: string;
}

// Read a directory `<input>`'s FileList. Returns every text file with its
// folder-relative path; what to do with a loose file (one with no folder
// segment) is the caller's rule — the editor reads it as a lone package
// member, the workspace ignores it.
export async function readFileList(list: FileList): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    // `||`, not `??`: the DOM always DEFINES webkitRelativePath, using
    // the empty string for a File that did not come from a directory
    // pick. `??` would pass that "" straight through and every path
    // would then fail TEXT_FILE_RE, silently collecting nothing.
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    const folderName = parts.length > 1 ? parts[0]! : undefined;
    const path = parts.length > 1 ? parts.slice(1).join('/') : rel;
    if (!TEXT_FILE_RE.test(path)) continue;
    out.push({
      ...(folderName !== undefined && { folderName }),
      path,
      text: await f.text(),
    });
  }
  return out;
}

// ── writing ──────────────────────────────────────────────────────────

// Writing needs readwrite; a handle is only granted read at pick time.
export async function ensureReadwritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const desc = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(desc)) === 'granted') return;
  if ((await handle.requestPermission(desc)) !== 'granted') {
    throw new Error(
      'Folder write permission was denied. The browser will not let this app save in place.',
    );
  }
}

// `path` may name subfolders (`gear/hat.json`, `scenes/armed.scene.json`);
// the missing ones are created.
export async function writeTextFileAt(
  dir: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  const segments = path.split('/');
  const base = segments.pop()!;
  let target = dir;
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
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

// Delete `path` if it is there. An absent file is not an error: a second
// save after a successful delete has nothing left to do.
export async function removeFileAt(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const segments = path.split('/');
  const base = segments.pop()!;
  let target = dir;
  try {
    for (const seg of segments) {
      target = await target.getDirectoryHandle(seg);
    }
    await target.removeEntry(base);
  } catch {
    // Already gone.
  }
}

// ── downloading ──────────────────────────────────────────────────────

// The everywhere-else path: hand the browser a blob under a filename. A
// download cannot choose a folder, so `name` lands flat wherever the
// browser puts downloads.
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked a tick later: some builds race the revoke against the
  // navigation that starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(
  name: string,
  text: string,
  type = 'text/plain;charset=utf-8',
): void {
  downloadBlob(new Blob([text], { type }), name);
}
