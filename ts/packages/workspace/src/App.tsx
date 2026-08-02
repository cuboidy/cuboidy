import { useCallback, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  AppHeader,
  Dock,
  HeaderDivider,
  addPanelAt,
  closePanelAt,
  placePanelBeside,
  placedPanels,
  splitLeafWith,
  withActiveAt,
  withRatioAt,
  type Edge,
  type LayoutNode,
  type PanelContent,
  type Side,
} from '@cuboidy/ui';
import { ModelList, SocketList } from './components/ModelList.js';
import { SceneView } from './components/SceneView.js';
import { DragLayer } from './components/DragLayer.js';
import { AnimationPanel } from './components/AnimationPanel.js';
import { AttachProperties, SceneBar } from './components/SceneTree.js';
import { SceneTreePanel } from './components/SceneTreePanel.js';
import {
  canUseDirectoryPicker,
  openLibraryFromInput,
  openLibraryWithPicker,
} from './lib/open-folder.js';
import type { Library } from './lib/library.js';
import {
  ALL_PANELS,
  PANEL_TITLES,
  initialLayout,
  type PanelId,
} from './lib/panels.js';
import {
  addInstance,
  anyPlaying,
  emptyScene,
  placeScene,
  removeInstance,
  sceneTree,
  setAnimation,
  setAttachment,
  setPlacement,
  type Scene,
} from './lib/scene.js';
import { parseScene, serializeScene } from './lib/scene-file.js';
import { saveScene } from './lib/save-scene.js';
import { useSceneClock } from './lib/useSceneClock.js';
import { useThumbnails } from './lib/useThumbnails.js';
import {
  DEFAULT_GIZMOS,
  type SceneGizmos,
  type SceneTool,
  type SceneViewMode,
} from './lib/view.js';
import type { DropTarget } from './lib/drop.js';

const PAUSE_FIRST = 'Pause playback before moving things';

// Cuboidy Workspace — stage 1: open a folder of models, put them in a
// scene, attach them to each other's published sockets.
//
// The editor and this are separate apps on purpose. The editor is closed
// over ONE model; a workspace holds a scene of several. What they share is
// @cuboidy/ui — the dock, and the components that draw a rigged model —
// and core, which owns every rule either of them applies. Neither shares a
// panel set with the other, because the panels are what differ.

export function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [scene, setScene] = useState<Scene>(() => emptyScene());
  const [selected, setSelected] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sceneStatus, setSceneStatus] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutNode<PanelId> | null>(initialLayout);
  // Anim view by default: choosing a clip starts it, and a default that
  // showed the rest pose would make that look like nothing happened.
  const [viewMode, setViewMode] = useState<SceneViewMode>('anim');
  const [tool, setTool] = useState<SceneTool>('select');
  const [gizmos, setGizmos] = useState<SceneGizmos>(DEFAULT_GIZMOS);
  // A library card in flight: which model, and where it would land. Held
  // here because three separate places need it — the layer that follows
  // the cursor, the 3D view that resolves the landing point, and the drop
  // that commits it.
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const adopt = useCallback((next: Library) => {
    setLibrary(next);
    setError(null);
    setScene(emptyScene(next.name));
    setSceneStatus(null);
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

  // One picture per model, rendered once when the library opens. Also
  // what follows the cursor while a card is dragged.
  const thumbnails = useThumbnails(library);

  // Anim view needs something in the scene that can animate — otherwise
  // it is rig view with a different name on it. Derived from the scene
  // rather than from the placed result, so it can gate the placement.
  const animUnavailable = useMemo(() => {
    if (library === null || scene.instances.length === 0) {
      return 'Nothing in the scene yet';
    }
    const animated = new Set(
      library.models.filter((m) => m.animations.size > 0).map((m) => m.dir),
    );
    return scene.instances.some((i) => animated.has(i.model))
      ? undefined
      : 'No model in the scene defines an animation';
  }, [library, scene]);
  // A mode nothing can render is a blank pane with no explanation, so the
  // view falls back while the user's choice is kept.
  const effectiveView: SceneViewMode =
    viewMode === 'anim' && animUnavailable !== undefined ? 'rig' : viewMode;

  // One clock for the scene, running only while something plays — and
  // only while a view is watching. Rig view stops it rather than merely
  // ignoring it: a clock nobody reads is frames nobody sees.
  const playing = anyPlaying(scene) && effectiveView === 'anim';
  const { time, seek } = useSceneClock(playing);
  const placed = useMemo(
    () =>
      library === null
        ? []
        : placeScene(scene, library, time, { rest: effectiveView === 'rig' }),
    [scene, library, time, effectiveView],
  );
  const roots = useMemo(() => sceneTree(placed), [placed]);
  // The resolved scene, for tests. Where an instance ENDED UP is the only
  // way to tell an attachment that took effect from one that merely says
  // it did, and a canvas cannot be asked. Read-only, and cheap.
  (window as unknown as { __scene?: unknown }).__scene = placed;
  const selectedPlaced = placed.find((p) => p.instance.id === selected) ?? null;
  // The detail panels follow the SCENE selection when there is one, and the
  // library browse otherwise — so clicking a library row previews it and
  // clicking an instance inspects that.
  const detailModel =
    selectedPlaced?.model ??
    library?.models.find((m) => m.dir === browsing) ??
    null;

  // Opening a scene replaces the current one. A scene that does not parse
  // reports why and leaves what is on screen alone — losing an
  // arrangement to a typo in a different file would be a poor trade.
  const openSceneFile = useCallback(
    (file: string) => {
      const text = library?.scenes.get(file);
      if (text === undefined) return;
      const r = parseScene(text, file.replace(/\.scene\.json$/i, ''));
      if (!r.ok) {
        setSceneStatus(`${file}: ${r.error}`);
        return;
      }
      setScene(r.scene);
      setSelected(null);
      setSceneStatus(`Opened ${file}.`);
    },
    [library],
  );

  const handleSaveScene = useCallback(() => {
    if (library === null) return;
    void saveScene(scene, library)
      .then((out) => {
        setSceneStatus(
          out.kind === 'wrote'
            ? `Saved ${out.file} into ${library.name}.`
            : `Downloaded ${out.file} — move it into ${library.name} beside the models it references.`,
        );
      })
      .catch((e: Error) => setSceneStatus(`Could not save: ${e.message}`));
  }, [scene, library]);

  // Put a model in the scene, at wherever the drag resolved to (or the
  // origin, for a double-click that expressed no place).
  const place = useCallback((model: string, at?: DropTarget | null) => {
    setScene((s) => {
      const next = addInstance(s, model, at ?? undefined);
      setSelected(next.instances[next.instances.length - 1]?.id ?? null);
      return next;
    });
  }, []);

  const draggedModel = useMemo(
    () =>
      dragging === null
        ? null
        : (library?.models.find((m) => m.dir === dragging) ?? null),
    [dragging, library],
  );

  // A transform drag mutates the group's matrix imperatively — that IS the
  // live preview — but a running clock re-renders every instance's frame
  // 60 times a second and would overwrite it mid-drag. Rather than fight
  // that, the tools say to pause.
  const toolDisabled = useMemo<Partial<Record<SceneTool, string>>>(
    () => (playing ? { move: PAUSE_FIRST, rotate: PAUSE_FIRST } : {}),
    [playing],
  );
  // The chosen tool survives being unavailable; only its EFFECT falls back
  // to select, so pausing restores what was picked.
  const effectiveTool: SceneTool =
    toolDisabled[tool] === undefined ? tool : 'select';

  const renderPanel = useCallback(
    (id: PanelId): PanelContent | null => {
      const title = PANEL_TITLES[id];
      if (library === null) return { title, body: null };
      switch (id) {
        case 'models':
          return {
            title,
            body: (
              <div className="panel-body">
                <ModelList
                  library={library}
                  thumbnails={thumbnails}
                  selected={browsing}
                  onSelect={setBrowsing}
                  onPlace={place}
                  onDrag={setDragging}
                />
                {library.skipped.length > 0 && (
                  <p className="hint skipped">
                    Skipped (no cuboidy.json): {library.skipped.join(', ')}
                  </p>
                )}
              </div>
            ),
          };
        case 'scene':
          return {
            title,
            body: (
              <div className="panel-body">
                <SceneBar
                  name={scene.name}
                  files={[...library.scenes.keys()]}
                  onRename={(n) => setScene((s) => ({ ...s, name: n }))}
                  onOpen={openSceneFile}
                  onSave={handleSaveScene}
                  status={sceneStatus}
                />
              </div>
            ),
          };
        case 'tree':
          return {
            title,
            body: (
              <div className="panel-body">
                <SceneTreePanel
                  roots={roots}
                  all={placed}
                  selected={selected}
                  onSelect={setSelected}
                  onRemove={(id2) => {
                    setScene((s) => removeInstance(s, id2));
                    setSelected((cur) => (cur === id2 ? null : cur));
                  }}
                  onAttach={(id2, hostId) => {
                    setScene((s) => {
                      if (hostId === null) return setAttachment(s, id2, null);
                      // A drop onto a host means "attach"; WHICH socket is
                      // a second decision, so it takes the first published
                      // one and the Attachment panel changes it.
                      const host = placed.find((x) => x.instance.id === hostId);
                      const first = Object.keys(
                        host?.model.manifest.sockets ?? {},
                      )[0];
                      return first === undefined
                        ? s
                        : setAttachment(s, id2, { to: hostId, socket: first });
                    });
                  }}
                />
              </div>
            ),
          };
        case 'view':
          return {
            title,
            fill: true,
            body: (
              <SceneView
                placed={placed}
                selected={selected}
                viewMode={effectiveView}
                animUnavailable={animUnavailable}
                tool={effectiveTool}
                toolDisabled={toolDisabled}
                gizmos={gizmos}
                onSelect={setSelected}
                dragModel={draggedModel}
                onDropTarget={setDropTarget}
                onDropModel={place}
                onSetTool={setTool}
                onToggleGizmo={(kind) =>
                  setGizmos((g) => ({ ...g, [kind]: !g[kind] }))
                }
                onChangeViewMode={setViewMode}
                onMove={(id2, pos) =>
                  setScene((s) => setPlacement(s, id2, { pos }))
                }
                onRotate={(id2, rot) =>
                  setScene((s) => setPlacement(s, id2, { rot }))
                }
              />
            ),
          };
        case 'attachment':
          return {
            title,
            body: (
              <div className="panel-body">
                <AttachProperties
                placed={selectedPlaced}
                all={placed}
                onAttach={(id2, target) =>
                  setScene((s) => setAttachment(s, id2, target))
                  }
                />
              </div>
            ),
          };
        case 'animation':
          return {
            title,
            body: (
              <div className="panel-body">
                <AnimationPanel
                  placed={selectedPlaced}
                  sceneTime={time}
                  atRest={effectiveView === 'rig'}
                  onSeek={seek}
                  onSet={(id2, anim) =>
                    setScene((s) => setAnimation(s, id2, anim))
                  }
                />
              </div>
            ),
          };
        case 'source':
          // What Save would write, live. Read-only: the scene is edited
          // through the panels, and a second editable copy of the same
          // state is a synchronisation problem with nothing to gain —
          // the editor keeps source tabs writable because a MODEL has
          // things (voxel rows) no form expresses, and a scene does not.
          return {
            title,
            fill: true,
            body: <pre className="source-view">{serializeScene(scene)}</pre>,
          };
        case 'sockets':
          return {
            title,
            body: (
              <div className="panel-body">
                <SocketList model={detailModel} />
              </div>
            ),
          };
        case 'problems':
          return {
            title,
            body: (
              <div className="panel-body">
                {detailModel === null || detailModel.problems.length === 0 ? (
                  <p className="empty">No problems.</p>
                ) : (
                  <ul className="problem-list">
                    {detailModel.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          };
      }
    },
    [
      library,
      thumbnails,
      browsing,
      place,
      roots,
      selected,
      placed,
      selectedPlaced,
      detailModel,
      scene,
      time,
      seek,
      sceneStatus,
      openSceneFile,
      handleSaveScene,
      effectiveView,
      effectiveTool,
      animUnavailable,
      toolDisabled,
      gizmos,
      draggedModel,
    ],
  );

  const closed = useMemo(() => {
    const here = layout === null ? new Set<PanelId>() : placedPanels(layout);
    return ALL_PANELS.filter((id) => !here.has(id)).map((id) => ({
      id,
      title: PANEL_TITLES[id],
    }));
  }, [layout]);

  return (
    <div className="app">
      <AppHeader
        product="Workspace"
        right={
          <>
            {library !== null && (
              <>
                <span className="library-name">{library.name}</span>
                <HeaderDivider />
              </>
            )}
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
          </>
        }
      />

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
      ) : layout === null ? (
        <p className="empty">
          Every panel is closed. Reopen one from a panel&apos;s + menu.
        </p>
      ) : (
        <main className="dock-host">
          <Dock
            node={layout}
            getPanel={renderPanel}
            closedPanels={closed}
            onResize={(path, ratio) =>
              setLayout((l) => (l === null ? l : withRatioAt(l, path, ratio)))
            }
            onActivate={(path, id) =>
              setLayout((l) => (l === null ? l : withActiveAt(l, path, id)))
            }
            onClose={(path, id) =>
              setLayout((l) => (l === null ? l : closePanelAt(l, path, id)))
            }
            onAdd={(path, id) =>
              setLayout((l) => (l === null ? l : addPanelAt(l, path, id)))
            }
            onSplit={(toPath: Side[], edge: Edge, id, fromPath) =>
              setLayout((l) =>
                l === null ? l : splitLeafWith(l, toPath, edge, id, fromPath),
              )
            }
            onReorder={(toPath, targetId, before, id, fromPath) =>
              setLayout((l) =>
                l === null
                  ? l
                  : placePanelBeside(l, toPath, targetId, before, id, fromPath),
              )
            }
          />
        </main>
      )}

      {/* Outside the dock, so it is not clipped by whichever panel the
          drag started in. */}
      <DragLayer
        model={dragging}
        thumb={dragging === null ? undefined : thumbnails.get(dragging)}
        target={dropTarget}
      />
    </div>
  );
}

