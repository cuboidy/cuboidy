import { buildLibrary, type Library } from './library.js';

// Reading a library folder off disk. Two paths, for the same reason the
// editor has two: Chrome/Edge expose the File System Access API, and
// everywhere else there is `<input webkitdirectory>`.
//
// Only text is read. The workspace never writes a model back — it
// references models — so there is no need to carry unknown binary entries
// through the way the editor must (SPEC §13.3 is about a package's own
// round trip, and this is not one).

const TEXT_FILE_RE = /\.(json|md|txt)$/i;

export function canUseDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function openLibraryWithPicker(): Promise<Library> {
  const picker = (
    window as unknown as {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  const handle = await picker();
  const files = new Map<string, string>();
  await collect(handle, '', files);
  // The handle is kept: it is what lets a scene be saved back into the
  // folder it was built from, rather than landing in Downloads.
  return buildLibrary(handle.name, files, handle);
}

export async function openLibraryFromInput(list: FileList): Promise<Library> {
  const files = new Map<string, string>();
  let name = 'library';
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    // `||` not `??`: the DOM always DEFINES webkitRelativePath and uses
    // "" for a File that did not come from a directory picker, which `??`
    // would pass straight through.
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    if (parts.length > 1) {
      name = parts[0]!;
      const inner = parts.slice(1).join('/');
      if (TEXT_FILE_RE.test(inner)) files.set(inner, await f.text());
    }
  }
  return buildLibrary(name, files);
}

async function collect(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Map<string, string>,
): Promise<void> {
  for await (const entry of dir.values()) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      await collect(entry as FileSystemDirectoryHandle, path, out);
    } else if (TEXT_FILE_RE.test(entry.name)) {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.set(path, await file.text());
    }
  }
}
