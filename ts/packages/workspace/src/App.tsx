import { useCallback, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { ModelList, SocketList } from './components/ModelList.js';
import { ModelView } from './components/ModelView.js';
import {
  canUseDirectoryPicker,
  openLibraryFromInput,
  openLibraryWithPicker,
} from './lib/open-folder.js';
import type { Library } from './lib/library.js';

// Cuboidy Workspace — stage 1, first chunk: open a folder of models, list
// them, draw the selected one.
//
// The editor and this are separate apps on purpose. The editor is closed
// over ONE model; a workspace holds a scene of several. Trying to be both
// was rejected during design because the panel set and the preview modes
// fork at every level. What they share is @cuboidy/ui, which knows how to
// draw a model and nothing about documents.

export function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: Library) => {
    setLibrary(next);
    setError(null);
    setSelected(next.models[0]?.dir ?? null);
  }, []);

  const handlePick = useCallback(async () => {
    try {
      adopt(await openLibraryWithPicker());
    } catch (e) {
      // An aborted picker is the user changing their mind, not a failure.
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message);
    }
  }, [adopt]);

  const model =
    library?.models.find((m) => m.dir === selected) ?? null;

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
                  void openLibraryFromInput(files).then(adopt).catch((err: Error) => {
                    setError(err.message);
                  });
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
              selected={selected}
              onSelect={setSelected}
            />
            {library.skipped.length > 0 && (
              <p className="hint skipped">
                Skipped (no cuboidy.json): {library.skipped.join(', ')}
              </p>
            )}
          </aside>

          <section className="viewport">
            <ModelView model={model} />
          </section>

          <aside className="panel panel-detail">
            <h2>Published sockets</h2>
            <SocketList model={model} />
            {model !== null && model.problems.length > 0 && (
              <>
                <h2>Problems</h2>
                <ul className="problem-list">
                  {model.problems.map((p) => (
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
