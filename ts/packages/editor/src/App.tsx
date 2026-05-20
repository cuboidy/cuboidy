import { useCallback, useState } from 'react';
import { FileDropZone } from './components/FileDropZone.js';
import { Sidebar } from './components/Sidebar.js';
import { VoxelScene } from './components/VoxelScene.js';
import { loadModel, type LoadResult } from './lib/load-model.js';

export function App() {
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  // Per-part mute. Resets on every new file load. Empty set = all visible.
  // Stored by part name (parser guarantees uniqueness within a file).
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    setLoaded(loadModel(text, file.name));
    setHiddenParts(new Set());
  }, []);

  const handleReset = useCallback(() => {
    setLoaded(null);
    setHiddenParts(new Set());
  }, []);

  const handleToggle = useCallback((name: string) => {
    setHiddenParts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => setHiddenParts(new Set()), []);

  const handleHideAll = useCallback(() => {
    setLoaded((current) => {
      if (current?.cvox !== undefined) {
        setHiddenParts(new Set(current.cvox.parts.map((p) => p.name)));
      }
      return current;
    });
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Cuboidy Editor</h1>
        <div className="status">
          {loaded !== null ? (
            <>
              <span className="fname">{loaded.fileName}</span>
              <button type="button" className="reset" onClick={handleReset}>
                Load another
              </button>
            </>
          ) : (
            <span className="muted">No model loaded</span>
          )}
        </div>
      </header>
      <main className="main">
        {loaded?.cvox !== undefined ? (
          <>
            <Sidebar
              cvox={loaded.cvox}
              hiddenParts={hiddenParts}
              onToggle={handleToggle}
              onShowAll={handleShowAll}
              onHideAll={handleHideAll}
            />
            <div className="scene-container">
              <VoxelScene cvox={loaded.cvox} hiddenParts={hiddenParts} />
            </div>
          </>
        ) : (
          <FileDropZone onFile={handleFile} />
        )}
      </main>
      {loaded !== null && <Notices loaded={loaded} />}
    </div>
  );
}

function Notices({ loaded }: { loaded: LoadResult }) {
  return (
    <aside className="notices">
      {loaded.error !== undefined && (
        <div className="notice error">
          <strong>Parse error:</strong> {loaded.error}
        </div>
      )}
      {loaded.cvox?.header !== undefined && (
        <div className="notice info">
          <strong>File header (preserved on save):</strong>
          <pre>{loaded.cvox.header.join('\n')}</pre>
        </div>
      )}
      {loaded.droppedInlineComments > 0 && (
        <div className="notice warning">
          <strong>
            {loaded.droppedInlineComments} inline comment(s) will not be preserved.
          </strong>{' '}
          Only file-header comments (consecutive <code>//</code> lines before
          the first declaration) round-trip through the editor.
        </div>
      )}
    </aside>
  );
}
