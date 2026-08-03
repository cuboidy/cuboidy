import { useCallback, useMemo, useState } from 'react';
import { useSaveFlash, type SaveState } from '@cuboidy/ui';
import type { Library } from './library.js';
import { emptyScene, type Scene } from './scene-doc.js';
import { parseScene, serializeScene } from './scene-file.js';
import { saveScene } from './save-scene.js';

// Which file the scene came from, what was in it, and everything that
// changes the two together: open / new / save, the dirty check, the
// save-button state and the notice banner. This is the APP's state
// rather than the document's — a scene does not know its own name, and
// "has it changed" is a question about the pair.
export function useSceneDocument({
  scene,
  library,
  replace,
  onDocumentSwap,
}: {
  scene: Scene;
  library: Library | null;
  // useSceneHistory's replace: a different document, history cleared.
  replace: (next: Scene) => void;
  // A different document landed (open / new): the caller drops whatever
  // points into the previous scene (the selection).
  onDocumentSwap: () => void;
}): {
  sceneFile: string | null;
  // What Save would write — also the source panel's body and the dirty
  // check's left-hand side. Memoized on the scene: during playback only
  // the clock changes, and serializing per rAF tick was measurable work
  // for an unchanged answer.
  sourceText: string;
  dirty: boolean;
  saveState: SaveState;
  // Something that needs reading: a save that could only download, a
  // file that would not parse. NOT "Saved x." — a write that worked says
  // so on the button and then gets out of the way.
  notice: string | null;
  dismissNotice: () => void;
  openSceneFile: (file: string) => void;
  newScene: () => void;
  save: (file: string) => void;
  // A new library replaces everything; the doc half of that reset.
  resetForLibrary: () => void;
} {
  const [notice, setNotice] = useState<string | null>(null);
  const {
    state: saveState,
    setSaving,
    flashSaved,
    reset: resetSaveState,
  } = useSaveFlash();
  const [sceneFile, setSceneFile] = useState<string | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);

  const sourceText = useMemo(() => serializeScene(scene), [scene]);

  // Would saving change the file? Comparing serializations rather than
  // tracking edits: every mutation would otherwise have to remember to
  // set a flag, and the one that forgets is invisible.
  const dirty =
    savedText === null ? scene.instances.length > 0 : sourceText !== savedText;

  // Both routes out of a scene ask before throwing unsaved work away.
  const mayDiscard = useCallback(
    (what: string): boolean =>
      !dirty ||
      // eslint-disable-next-line no-alert
      window.confirm(`${what} without saving the current scene?`),
    [dirty],
  );

  // Opening a scene replaces the current one. A scene that does not parse
  // reports why and leaves what is on screen alone — losing an
  // arrangement to a typo in a different file would be a poor trade.
  const openSceneFile = useCallback(
    (file: string) => {
      const text = library?.scenes.get(file);
      if (text === undefined) return;
      if (!mayDiscard(`Open ${file}`)) return;
      const r = parseScene(text);
      if (!r.ok) {
        setNotice(`${file}: ${r.error}`);
        return;
      }
      replace(r.scene);
      setSceneFile(file);
      // The SERIALIZATION of what was parsed, not the bytes on disk. A
      // hand-formatted file, or one still carrying the old `name`, would
      // otherwise read as modified the moment it opened.
      setSavedText(serializeScene(r.scene));
      onDocumentSwap();
      setNotice(null);
    },
    [library, mayDiscard, replace, onDocumentSwap],
  );

  const newScene = useCallback(() => {
    if (!mayDiscard('Start a new scene')) return;
    replace(emptyScene());
    setSceneFile(null);
    setSavedText(null);
    onDocumentSwap();
    setNotice(null);
  }, [mayDiscard, replace, onDocumentSwap]);

  const save = useCallback(
    (file: string) => {
      if (library === null) return;
      const written = sourceText;
      setSaving();
      void saveScene(scene, library, file)
        .then((out) => {
          setSceneFile(out.file);
          setSavedText(written);
          if (out.kind === 'wrote') {
            // The button says it and then stops saying it. A banner for
            // something that simply worked is a banner you learn to
            // ignore, which is how the next one gets missed too.
            flashSaved();
            setNotice(null);
          } else {
            // This one needs doing something about: the browser can only
            // drop a file in Downloads, flat, and it has to be moved.
            resetSaveState();
            setNotice(
              `Downloaded ${out.downloadedAs ?? out.file} — move it to ${library.name}/${out.file}, beside the models it references.`,
            );
          }
        })
        .catch((e: Error) => {
          resetSaveState();
          setNotice(`Could not save: ${e.message}`);
        });
    },
    [scene, library, sourceText, setSaving, flashSaved, resetSaveState],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);
  const resetForLibrary = useCallback(() => {
    setSceneFile(null);
    setSavedText(null);
    setNotice(null);
    resetSaveState();
  }, [resetSaveState]);

  return {
    sceneFile,
    sourceText,
    dirty,
    saveState,
    notice,
    dismissNotice,
    openSceneFile,
    newScene,
    save,
    resetForLibrary,
  };
}
