import { useCallback, useRef, useState } from 'react';
import { parseCvox, serializeCvox, type Cvox } from '@cuboidy/core';
import { ExportMenu } from './components/ExportMenu.js';
import { FileDropZone } from './components/FileDropZone.js';
import { FilePreview } from './components/FilePreview.js';
import { RightPanel } from './components/RightPanel.js';
import { SaveButton } from './components/SaveButton.js';
import { Sidebar } from './components/Sidebar.js';
import { SourceEditor } from './components/SourceEditor.js';
import { TabBar } from './components/TabBar.js';
import { ViewModeToggle } from './components/ViewModeToggle.js';
import { VoxelScene } from './components/VoxelScene.js';
import { synthesizeManifest } from './lib/synthesize-manifest.js';
import type {
  LoadResult,
  LoadedSource,
  SelectedTab,
  ViewMode,
} from './lib/types.js';

// Debounce window for live re-parse of the cvox source view. Long
// enough that mid-keystroke typing doesn't constantly fire (and
// flicker palette/3D between transient invalid states); short enough
// that a deliberate pause feels live.
const REPARSE_DEBOUNCE_MS = 300;

export function App() {
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('cvox');
  const [selectedTab, setSelectedTab] = useState<SelectedTab>('preview');
  // Live parse error on the cvox source text. Non-null only while the
  // user's currently-typed text doesn't parse. Palette panel disables
  // itself in this state so its re-serialize doesn't clobber the
  // in-progress text.
  const [cvoxParseError, setCvoxParseError] = useState<string | null>(null);

  // Holds the timeout ID of the pending debounced reparse so we can
  // cancel it whenever new authoritative state arrives (further typing
  // resets the timer; palette edit pre-empts it entirely).
  const reparseTimer = useRef<number | null>(null);

  const cancelPendingReparse = useCallback(() => {
    if (reparseTimer.current !== null) {
      window.clearTimeout(reparseTimer.current);
      reparseTimer.current = null;
    }
  }, []);

  const handleLoad = useCallback(
    (result: LoadResult) => {
      cancelPendingReparse();
      setLoaded(result);
      setHiddenParts(new Set());
      setCvoxParseError(null);
      const hasManifest =
        result.source !== undefined &&
        result.source.kind === 'folder' &&
        result.source.manifest !== undefined;
      setViewMode(hasManifest ? 'rig' : 'cvox');
      setSelectedTab('preview');
    },
    [cancelPendingReparse],
  );

  const handleReset = useCallback(() => {
    cancelPendingReparse();
    setLoaded(null);
    setHiddenParts(new Set());
    setCvoxParseError(null);
    setViewMode('cvox');
    setSelectedTab('preview');
  }, [cancelPendingReparse]);

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

  const handleSelectTab = useCallback((tab: SelectedTab) => {
    setSelectedTab(tab);
  }, []);

  // Source-text edit (textarea typing). Updates the text immediately so
  // every keystroke persists; schedules a debounced reparse that
  // updates the AST when it succeeds. The text remains primary even
  // while temporarily unparseable — Save / Export still write what the
  // user typed.
  const handleEditSourceText = useCallback(
    (nextText: string) => {
      setLoaded((current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        const nextSource: LoadedSource = {
          ...src,
          cvoxFile: { ...src.cvoxFile, text: nextText },
        };
        return { ...current, source: nextSource };
      });
      cancelPendingReparse();
      reparseTimer.current = window.setTimeout(() => {
        reparseTimer.current = null;
        const result = parseCvox(nextText);
        if (result.ok) {
          setCvoxParseError(null);
          setLoaded((current) => {
            if (current?.source === undefined) return current;
            return {
              ...current,
              source: { ...current.source, cvox: result.value },
            };
          });
        } else {
          setCvoxParseError(result.message);
        }
      }, REPARSE_DEBOUNCE_MS);
    },
    [cancelPendingReparse],
  );

  // Palette / future structural edit on the AST. Re-serializes to
  // canonical text immediately and pre-empts any pending reparse
  // (the new text is by-construction parseable, so we know the
  // error state is cleared too).
  const handleEditCvox = useCallback(
    (nextCvox: Cvox) => {
      cancelPendingReparse();
      setCvoxParseError(null);
      setLoaded((current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        const nextText = serializeCvox(nextCvox);
        const nextSource: LoadedSource = {
          ...src,
          cvox: nextCvox,
          cvoxFile: { ...src.cvoxFile, text: nextText },
        };
        return { ...current, source: nextSource };
      });
    },
    [cancelPendingReparse],
  );

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
        next = { ...src, synthetic: true, manifest, manifestFile };
        delete (next as { manifestError?: string }).manifestError;
      }
      setViewMode('rig');
      setSelectedTab('preview');
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
          {source !== undefined && selectedTab === 'preview' && (
            <ViewModeToggle
              mode={viewMode}
              rigAvailable={rigAvailable}
              onChange={handleViewModeChange}
            />
          )}
          {source?.kind === 'folder' && <SaveButton source={source} />}
          {source !== undefined && <ExportMenu source={source} />}
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
              selectedTab={selectedTab}
              hiddenParts={hiddenParts}
              onSelectTab={handleSelectTab}
              onToggle={handleToggle}
              onShowAll={handleShowAll}
              onHideAll={handleHideAll}
              onCreateManifest={handleCreateManifest}
            />
            <div className="main-pane">
              <TabBar
                source={source}
                selected={selectedTab}
                onSelect={handleSelectTab}
              />
              <div className="main-pane-body">
                {selectedTab === 'preview' && (
                  <VoxelScene
                    cvox={source.cvox}
                    manifest={
                      source.kind === 'folder' ? source.manifest : undefined
                    }
                    viewMode={viewMode}
                    hiddenParts={hiddenParts}
                  />
                )}
                {selectedTab === 'cvox' && (
                  <SourceEditor
                    text={source.cvoxFile.text}
                    {...(cvoxParseError !== null && { parseError: cvoxParseError })}
                    onChange={handleEditSourceText}
                  />
                )}
                {selectedTab === 'manifest' &&
                  source.kind === 'folder' &&
                  source.manifestFile !== undefined && (
                    <FilePreview file={source.manifestFile} />
                  )}
              </div>
            </div>
            <RightPanel
              cvox={source.cvox}
              cvoxEditsDisabled={cvoxParseError !== null}
              onCvoxChange={handleEditCvox}
            />
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
