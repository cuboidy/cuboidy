import { pickDirectory, readDirectoryHandle, readFileList } from '@cuboidy/ui';
import { buildLibrary, type Library } from './library.js';

// Reading a library folder off disk. Two paths, for the same reason the
// editor has two: Chrome/Edge expose the File System Access API, and
// everywhere else there is `<input webkitdirectory>`. The walks
// themselves are @cuboidy/ui/fs — both apps open a folder the same ways.
//
// Only text is read. The workspace never writes a model back — it
// references models — so there is no need to carry unknown binary entries
// through the way the editor must (SPEC §13.3 is about a package's own
// round trip, and this is not one).

export { canUseDirectoryPicker } from '@cuboidy/ui';

export async function openLibraryWithPicker(): Promise<Library> {
  const handle = await pickDirectory();
  // The handle is kept: it is what lets a scene be saved back into the
  // folder it was built from, rather than landing in Downloads.
  return buildLibrary(handle.name, await readDirectoryHandle(handle), handle);
}

export async function openLibraryFromInput(list: FileList): Promise<Library> {
  const files = new Map<string, string>();
  let name = 'library';
  for (const f of await readFileList(list)) {
    // A file with no folder segment is not part of a library: the
    // library IS the folder, and its models are found relative to it.
    if (f.folderName === undefined) continue;
    name = f.folderName;
    files.set(f.path, f.text);
  }
  return buildLibrary(name, files);
}
