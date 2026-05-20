import { useCallback, useState } from 'react';
import { FileDropZone } from './components/FileDropZone.js';
import { Sidebar } from './components/Sidebar.js';
import { ViewModeToggle } from './components/ViewModeToggle.js';
import { VoxelScene } from './components/VoxelScene.js';
import { synthesizeManifest } from './lib/synthesize-manifest.js';
import type { LoadResult, LoadedSource, ViewMode } from './lib/types.js';

export function App() {
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(new Set());
  // View mode persists across loads but is forced back to 'cbox' when
  // the loaded source has no manifest (Rig view would be meaningless).
  const [viewMode, setViewMode] = useState<ViewMode>('cbox');

  const handleLoad = useCallback((result: LoadResult) => {
    setLoaded(result);
    setHiddenParts(new Set());
    // Default to rig view when manifest is present (it's the "complete"
    // picture). Cbox view is reachable via toggle.
    const hasManifest =
      result.source !== undefined &&
      result.source.kind === 'folder' &&
      result.source.manifest !== undefined;
    setViewMode(hasManifest ? 'rig' : 'cbox');
  }, []);

  const handleReset = useCallback(() => {
    setLoaded(null);
    setHiddenParts(new Set());
    setViewMode('cbox');
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
      if (current?.source !== undefined) {
        setHiddenParts(new Set(current.source.cvox.parts.map((p) => p.name)));
      }
      return current;
    });
  }, []);

  // Create manifest: upgrades a cvox-only source into a synthetic folder,
  // or fills in a manifest for a folder that didn't have one. The
  // synthesized manifest places every part at the origin with no parent;
  // user edits parent/position later via the rig editor (A2-rig-5+).
  const handleCreateManifest = useCallback(() => {
    setLoaded((current) => {
      if (current?.source === undefined) return current;
      const src = current.source;
      const manifest = synthesizeManifest(src.cvox, src.cvoxFile.name);
      const manifestText = JSON.stringify(manifest, null, 2) + '\n';
      const manifestFile = { name: 'cuboidy.json', text: manifestText };
      let next: LoadedSource;
      if (src.kind === 'cvox-only') {
        next = {
          kind: 'folder',
          folderName: manifest.name,
          synthetic: true,
          cvox: src.cvox,
          cvoxFile: src.cvoxFile,
          manifest,
          manifestFile,
          droppedInlineComments: src.droppedInlineComments,
        };
      } else {
        next = {
          ...src,
          synthetic: true,
          manifest,
          manifestFile,
        };
        // Strip any prior parse error since we now have a valid manifest.
        delete (next as { manifestError?: string }).manifestError;
      }
      setViewMode('rig');
      return { ...current, source: next };
    });
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const source = loaded?.source;
  const rigAvailable =
    source !== undefined && source.kind === 'folder' && source.manifest !== undefined;

  return (
    <div className="app">
      <header className="header">
        <h1>Cuboidy Editor</h1>
        <div className="header-right">
          {source !== undefined && (
            <ViewModeToggle
              mode={viewMode}
              rigAvailable={rigAvailable}
              onChange={handleViewModeChange}
            />
          )}
          {loaded !== null && (
            <button type="button" className="reset" onClick={handleReset}>
              Load another
            </button>
          )}
        </div>
      </header>
      <main className="main">
        {source !== undefined ? (
          <>
            <Sidebar
              source={source}
              hiddenParts={hiddenParts}
              onToggle={handleToggle}
              onShowAll={handleShowAll}
              onHideAll={handleHideAll}
              onCreateManifest={handleCreateManifest}
            />
            <div className="scene-container">
              <VoxelScene
                cvox={source.cvox}
                manifest={
                  source.kind === 'folder' ? source.manifest : undefined
                }
                viewMode={viewMode}
                hiddenParts={hiddenParts}
              />
            </div>
          </>
        ) : (
          <FileDropZone onLoad={handleLoad} />
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
      {loaded.source?.kind === 'folder' &&
        loaded.source.manifestError !== undefined && (
          <div className="notice error">
            <strong>Manifest error ({loaded.source.manifestFile?.name}):</strong>{' '}
            {loaded.source.manifestError}
          </div>
        )}
      {loaded.source?.cvox?.header !== undefined && (
        <div className="notice info">
          <strong>File header (preserved on save):</strong>
          <pre>{loaded.source.cvox.header.join('\n')}</pre>
        </div>
      )}
      {loaded.source !== undefined && loaded.source.droppedInlineComments > 0 && (
        <div className="notice warning">
          <strong>
            {loaded.source.droppedInlineComments} inline comment(s) will not be preserved.
          </strong>{' '}
          Only file-header comments (consecutive <code>//</code> lines before
          the first declaration) round-trip through the editor.
        </div>
      )}
    </aside>
  );
}
