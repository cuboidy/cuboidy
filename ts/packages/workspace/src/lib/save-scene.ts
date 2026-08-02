import type { Library } from './library.js';
import { SCENE_EXT, serializeScene } from './scene-file.js';
import type { Scene } from './scene.js';

// Writing a scene back.
//
// A scene belongs INSIDE the library it was built from — the library is
// the namespace its `model` keys resolve in, so a scene saved anywhere
// else is a file whose references only work by luck. Where inside is up
// to whoever names it: `armed.scene.json` and `scenes/armed.scene.json`
// both resolve the same, because the root is the folder that was opened
// and not the folder the scene happens to sit in.
//
// When the folder was opened through the File System Access API we can
// write in place; otherwise the browser will only give us a download, and
// the user has to put it there themselves. That difference is worth
// reporting, which is why this says which happened.

export interface SaveOutcome {
  kind: 'wrote' | 'downloaded';
  // Where in the library this scene now lives — the path that was asked
  // for, which is what the document IS from here on. Not the same as what
  // a download was called: a download cannot choose a folder, so it lands
  // flat and the user has to move it, and telling them it is now called
  // something else would be telling them the wrong place to put it.
  file: string;
  // The flat name the browser used, when it was a download.
  downloadedAs?: string;
}

// A typed name to a library-relative path. Accepts a bare name, a name
// with the extension already on it, or a path into a subfolder.
export function sceneFileName(input: string): string {
  const base = input.trim().replace(/^\/+/, '');
  if (base === '') return `untitled${SCENE_EXT}`;
  return base.endsWith(SCENE_EXT) ? base : `${base}${SCENE_EXT}`;
}

export async function saveScene(
  scene: Scene,
  library: Library,
  path: string,
): Promise<SaveOutcome> {
  const file = sceneFileName(path);
  const text = serializeScene(scene);
  if (library.handle !== undefined) {
    const segments = file.split('/');
    const name = segments.pop()!;
    // Walk into (and create) the subfolders the path names, so saving to
    // `scenes/armed.scene.json` works on a library that has no `scenes`
    // folder yet.
    let dir = library.handle;
    for (const seg of segments) {
      if (seg === '' || seg === '.') continue;
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { kind: 'wrote', file };
  }
  const flat = file.split('/').pop()!;
  download(flat, text);
  return { kind: 'downloaded', file, downloadedAs: flat };
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
