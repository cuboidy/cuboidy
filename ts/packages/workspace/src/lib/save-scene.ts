import type { Library } from './library.js';
import { SCENE_EXT, serializeScene } from './scene-file.js';
import type { Scene } from './scene.js';

// Writing a scene back.
//
// A scene belongs BESIDE the models it references — the library folder is
// the namespace its `model` keys are resolved in, so a scene saved
// anywhere else is a file whose references only work by luck. When the
// folder was opened through the File System Access API we can put it
// there; otherwise the browser will only give us a download, and the user
// has to move it themselves. That difference is worth reporting, which is
// why this says which happened rather than just resolving.

export type SaveOutcome =
  | { kind: 'wrote'; file: string }
  | { kind: 'downloaded'; file: string };

export function sceneFileName(scene: Scene): string {
  const base = scene.name.trim() === '' ? 'untitled' : scene.name.trim();
  return base.endsWith(SCENE_EXT) ? base : `${base}${SCENE_EXT}`;
}

export async function saveScene(
  scene: Scene,
  library: Library,
): Promise<SaveOutcome> {
  const file = sceneFileName(scene);
  const text = serializeScene(scene);
  if (library.handle !== undefined) {
    const handle = await library.handle.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { kind: 'wrote', file };
  }
  download(file, text);
  return { kind: 'downloaded', file };
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
