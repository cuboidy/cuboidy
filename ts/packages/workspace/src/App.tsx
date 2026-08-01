import { useCallback, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { ModelList, SocketList } from './components/ModelList.js';
import { SceneView } from './components/SceneView.js';
import { AttachProperties, SceneTree } from './components/SceneTree.js';
import {
  canUseDirectoryPicker,
  openLibraryFromInput,
  openLibraryWithPicker,
} from './lib/open-folder.js';
import type { Library } from './lib/library.js';
import {
  addInstance,
  emptyScene,
  placeScene,
  removeInstance,
  sceneTree,
  setAttachment,
  type Scene,
} from './lib/scene.js';

// Cuboidy Workspace — stage 1: open a folder of models, put them in a
// scene, attach them to each other's published sockets.
//
// The editor and this are separate apps on purpose. The editor is closed
// over ONE model; a workspace holds a scene of several. What they share is
// @cuboidy/ui, which knows how to draw a model and nothing about
// documents, and core, which owns every rule either of them applies.

export function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [scene, setScene] = useState<Scene>(() => emptyScene());
  const [selected, setSelected] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: Library) => {
    setLibrary(next);
    setError(null);
    setScene(emptyScene(next.name));
    setSelected(null);
    setBrowsing(next.models[0]?.dir ?? null);
  }, []);

  const handlePick = useCallback(async () => {
    try {
      adopt(await openLibraryWithPicker());
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user changed their mind
      setError((e as Error).message);
    }
  }, [adopt]);

  const placed = useMemo(
    () => (library === null ? [] : placeScene(scene, library)),
    [scene, library],
  );
  const roots = useMemo(() => sceneTree(placed), [placed]);
  // The resolved scene, for tests. Where an instance ENDED UP is the only
  // way to tell an attachment that took effect from one that merely says
  // it did, and a canvas cannot be asked. Read-only, and cheap.
  (window as unknown as { __scene?: unknown }).__scene = placed;
  const selectedPlaced = placed.find((p) => p.instance.id === selected) ?? null;
  // The right panel follows the SCENE selection when there is one, and the
  // library browse otherwise — so clicking a library row previews it and
  // clicking an instance inspects that.
  const detailModel =
    selectedPlaced?.model ??
    library?.models.find((m) => m.dir === browsing) ??
    null;

  const place = useCallback((model: string) => {
    setScene((s) => {
      const next = addInstance(s, model);
      setSelected(next.instances[next.instances.length - 1]?.id ?? null);
      return next;
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Cuboidy Workspace</span>
        {canUseDirectoryPicker() ? (
          <button type="button" className="btn" onClick={() => void handlePick()}>
            <FolderOpen size={14} />
            Open folder
          </button>
        ) : (
          <label className="btn">
            <FolderOpen size={14} />
            Open folder
            <input
              type="file"
              /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
              {...({ webkitdirectory: '' } as any)}
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (files !== null && files.length > 0) {
                  void openLibraryFromInput(files)
                    .then(adopt)
                    .catch((err: Error) => setError(err.message));
                }
              }}
            />
          </label>
        )}
        {library !== null && <span className="library-name">{library.name}</span>}
      </header>

      {error !== null && <p className="error-banner">{error}</p>}

      {library === null ? (
        <div className="landing">
          <h1>Open a folder of models</h1>
          <p>
            Every subfolder holding a <code>cuboidy.json</code> is a model
            (SPEC §3). The repository&apos;s <code>models/</code> directory is
            one such folder.
          </p>
        </div>
      ) : (
        <main className="layout">
          <aside className="panel panel-models">
            <h2>Models</h2>
            <ModelList
              library={library}
              selected={browsing}
              onSelect={setBrowsing}
              onPlace={place}
            />
            <h2>Scene</h2>
            <SceneTree
              roots={roots}
              selected={selected}
              onSelect={setSelected}
              onRemove={(id) => {
                setScene((s) => removeInstance(s, id));
                setSelected((cur) => (cur === id ? null : cur));
              }}
            />
            {library.skipped.length > 0 && (
              <p className="hint skipped">
                Skipped (no cuboidy.json): {library.skipped.join(', ')}
              </p>
            )}
          </aside>

          <section className="viewport">
            <SceneView placed={placed} onSelect={setSelected} onDropModel={place} />
          </section>

          <aside className="panel panel-detail">
            <h2>Attachment</h2>
            <AttachProperties
              placed={selectedPlaced}
              all={placed}
              onAttach={(id, target) =>
                setScene((s) => setAttachment(s, id, target))
              }
            />
            <h2>Published sockets</h2>
            <SocketList model={detailModel} />
            {detailModel !== null && detailModel.problems.length > 0 && (
              <>
                <h2>Problems</h2>
                <ul className="problem-list">
                  {detailModel.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}
