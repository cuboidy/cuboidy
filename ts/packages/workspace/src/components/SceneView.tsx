import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box, Crosshair, MousePointer2, Move, Plug, Rotate3d } from 'lucide-react';
import { Vector3, type Camera, type Object3D } from 'three';
import { clampToClip, quatFromEulerZXYDeg, type Geometry, type Palette } from '@cuboidy/core';
import {
  RiggedParts,
  ToggleGroup,
  ToolBar,
  ToolOverlay,
  TransformGizmoHost,
  Transport,
  ViewOverlay,
  ViewToggle,
  buildRigTree,
  computeSceneSpan,
} from '@cuboidy/ui';
import type { LibraryModel } from '../lib/library.js';
import { drawTree, type PlacedInstance, type SceneNode } from '../lib/scene.js';
import type { SceneGizmos, SceneTool, SceneViewMode } from '../lib/view.js';
import {
  dropKey,
  resolveDrop,
  socketCandidates,
  type DropTarget,
} from '../lib/drop.js';
import { InstanceGizmos } from './InstanceGizmos.js';
import { DropPreview } from './DropPreview.js';

interface Props {
  placed: readonly PlacedInstance[];
  selected: string | null;
  viewMode: SceneViewMode;
  // Reason anim view is unavailable, or undefined when it is offered.
  animUnavailable: string | undefined;
  tool: SceneTool;
  toolDisabled: Partial<Record<SceneTool, string>>;
  gizmos: SceneGizmos;
  // Instances not drawn. Their GROUPS still render, because a hidden host
  // still carries its guests — hiding a knight should not take the sword
  // out of the scene with it.
  hidden: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  // The model being dragged out of the library, and its outline drawn
  // where it would land. Resolved here because the camera is here.
  dragModel: LibraryModel | null;
  onDropTarget: (target: DropTarget | null) => void;
  // Dropping a library card onto the canvas adds it to the scene, at
  // whatever the drag resolved to.
  onDropModel: (model: string, at: DropTarget | null) => void;
  onSetTool: (tool: SceneTool) => void;
  onToggleGizmo: (kind: keyof SceneGizmos) => void;
  onChangeViewMode: (mode: SceneViewMode) => void;
  // Committed once per completed drag, already converted out of world
  // space into the frame the instance's placement is measured in.
  onMove: (id: string, pos: [number, number, number]) => void;
  onRotate: (id: string, rot: [number, number, number]) => void;
  // Playback for the SELECTED instance, in the strip under the canvas.
  // Runtime state, not part of the scene: what is playing belongs with
  // the view, the same as the camera and the view mode.
  sceneTime: number;
  onSetAnim: (
    id: string,
    anim: { clip: string; playing: boolean; at?: number } | null,
  ) => void;
  onSeek: (time: number) => void;
}

// The scene: every placed instance, each at the world frame the scene
// layer resolved for it.
//
// An attached guest is NOT nested under its host here — the scene layer
// resolves hosts before guests and hands back world frames, so every
// instance is a direct child of the canvas. That is what lets the move
// gizmo work the same way on both: the group's local transform is always
// the world one, and the only difference is which frame the commit
// converts back into.
//
// Nothing here recomputes an attachment; SPEC §7.8 / §6.12 live in core
// and the scene layer applies them once.
export function SceneView({
  placed,
  selected,
  viewMode,
  animUnavailable,
  tool,
  toolDisabled,
  gizmos,
  hidden,
  onSelect,
  dragModel,
  onDropTarget,
  onDropModel,
  onSetTool,
  onToggleGizmo,
  onChangeViewMode,
  onMove,
  onRotate,
  sceneTime,
  onSetAnim,
  onSeek,
}: Props) {
  const reach = useMemo(() => {
    let max = 8;
    for (const p of placed) {
      const g = viewGeometry(p.model);
      if (g === null) continue;
      const span = computeSceneSpan(g, p.model.manifest, 'rig');
      max = Math.max(max, span.w, span.h, span.d);
    }
    return max;
  }, [placed]);

  const selectedPlaced =
    placed.find((p) => p.instance.id === selected) ?? null;

  // Guests nested under their hosts, so a host's transform carries them.
  const roots = useMemo(() => drawTree(placed), [placed]);

  // id → the instance's outer group, registered from inside the canvas so
  // the transform gizmo has something to attach to.
  const objects = useRef(new Map<string, Object3D>());
  const register = useCallback((id: string, obj: Object3D | null) => {
    if (obj === null) objects.current.delete(id);
    else objects.current.set(id, obj);
  }, []);

  const transformMode =
    tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : null;

  // The camera, captured from inside the Canvas so the DOM-side drag
  // handlers can project with it. A ref rather than state: it is read
  // during an event, never rendered from.
  const view = useRef<Camera | null>(null);
  const canvasEl = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetKey = useRef('');

  // Every published socket in the scene, in world space. Recomputed when
  // the arrangement changes, not per pointer move.
  const candidates = useMemo(
    () => (dragModel === null ? [] : socketCandidates(placed)),
    [dragModel, placed],
  );

  const setTargetIfChanged = useCallback(
    (next: DropTarget | null) => {
      const key = dropKey(next);
      if (key === targetKey.current) return;
      targetKey.current = key;
      setTarget(next);
      onDropTarget(next);
    },
    [onDropTarget],
  );

  // Two read-only hooks for the tests, both about the RENDERED scene
  // rather than the resolved one — the distinction the flat graph got
  // wrong, where placeScene said a guest was on its host's socket and the
  // screen showed it a drag behind.
  //
  //   __renderHost   the instance whose group actually contains this one
  //   __renderWorld  where its group actually ends up
  //   __renderMeshes how many meshes it is drawing OF ITS OWN
  //
  // A canvas cannot be asked either question, and asserting on
  // window.__scene would only re-check the arithmetic against itself.
  useEffect(() => {
    const w = window as unknown as {
      __renderHost?: (id: string) => string | null;
      __renderWorld?: (id: string) => [number, number, number] | null;
      __renderMeshes?: (id: string) => number;
    };
    const groups = objects.current;
    // Of its OWN: the walk stops at any descendant that is another
    // instance's group, so a hidden host carrying a visible guest reads
    // zero rather than counting the guest's meshes as its own.
    w.__renderMeshes = (id) => {
      const g = groups.get(id);
      if (g === undefined) return 0;
      let n = 0;
      const walk = (o: Object3D): void => {
        for (const c of o.children) {
          if (typeof c.userData['instanceId'] === 'string') continue;
          if ((c as { isMesh?: boolean }).isMesh === true) n += 1;
          walk(c);
        }
      };
      walk(g);
      return n;
    };
    w.__renderHost = (id) => {
      let o = groups.get(id)?.parent ?? null;
      while (o !== null) {
        const owner = o.userData['instanceId'];
        if (typeof owner === 'string') return owner;
        o = o.parent;
      }
      return null;
    };
    w.__renderWorld = (id) => {
      const g = groups.get(id);
      if (g === undefined) return null;
      g.updateWorldMatrix(true, false);
      const v = new Vector3().setFromMatrixPosition(g.matrixWorld);
      return [v.x, v.y, v.z];
    };
    return () => {
      delete w.__renderHost;
      delete w.__renderWorld;
      delete w.__renderMeshes;
    };
  }, []);

  // Where a published socket is on screen, for the tests. A drop onto a
  // socket is aimed with the pointer, so a test that wants to prove the
  // aiming works has to know where to aim — and a canvas cannot be
  // queried for it. Read-only, and the same projection the drag uses.
  useEffect(() => {
    const w = window as unknown as {
      __socketPixel?: (host: string, socket: string) => [number, number] | null;
    };
    w.__socketPixel = (host, socket) => {
      const camera = view.current;
      const el = canvasEl.current;
      if (camera === null || el === null) return null;
      const hit = socketCandidates(placed).find(
        (c) => c.host === host && c.socket === socket,
      );
      if (hit === undefined) return null;
      const rect = el.getBoundingClientRect();
      const v = new Vector3(...hit.frame.pos).project(camera);
      if (v.z > 1) return null;
      return [((v.x + 1) / 2) * rect.width, ((-v.y + 1) / 2) * rect.height];
    };
    return () => {
      delete w.__socketPixel;
    };
  }, [placed]);

  // Pointer → where the model would land. Called on every dragover, but
  // it only re-renders when the ANSWER changes: the ground point is
  // snapped to whole units, so moving within one cell is not an event.
  const resolveAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const camera = view.current;
      if (camera === null) {
        setTargetIfChanged(null);
        return;
      }
      const px: [number, number] = [clientX - rect.left, clientY - rect.top];
      const ndc = new Vector3(
        (px[0] / rect.width) * 2 - 1,
        -(px[1] / rect.height) * 2 + 1,
        0.5,
      ).unproject(camera);
      const origin = camera.position;
      const dir = ndc.sub(origin).normalize();
      setTargetIfChanged(
        resolveDrop(
          {
            origin: [origin.x, origin.y, origin.z],
            dir: [dir.x, dir.y, dir.z],
          },
          px,
          candidates,
          (p) => {
            const v = new Vector3(p[0], p[1], p[2]).project(camera);
            // Behind the camera: `project` still returns a point, mirrored
            // through the origin, which would make a socket at your back
            // the nearest thing on screen.
            if (v.z > 1) return null;
            return [
              ((v.x + 1) / 2) * rect.width,
              ((-v.y + 1) / 2) * rect.height,
            ];
          },
        ),
      );
    },
    [candidates, setTargetIfChanged],
  );

  // What the transport acts on: the selected instance's clip, if it has
  // one. The clip list comes from its model, so an instance of a model
  // with no animations gets an inert strip with the reason on it.
  const clips = selectedPlaced === null ? [] : [...selectedPlaced.model.animations.keys()];
  const anim = selectedPlaced?.instance.anim;
  const clip =
    anim === undefined ? undefined : selectedPlaced?.model.animations.get(anim.clip);
  const clipPlaying = anim?.playing === true;
  // Where this instance actually is: the shared clock while playing, its
  // own frozen point while paused.
  // Wrapped into the clip: the shared clock is monotonic, so a looping
  // clip would otherwise peg the scrubber at the end while the model
  // carried on going round.
  const raw = clipPlaying ? sceneTime : (anim?.at ?? 0);
  const at =
    clip === undefined ? 0 : clampToClip(raw, clip.duration, clip.loop);
  // Cause before consequence. Rig view is checked LAST because the view
  // itself falls back to rig when nothing in the scene can animate —
  // leading with it would answer "why can I not play this sword?" with
  // "because you are in rig view", which is the same fact wearing a hat.
  const transportDisabled =
    selectedPlaced === null
      ? 'Select an instance to play its animation'
      : clips.length === 0
        ? `${selectedPlaced.model.dir} defines no animations`
        : clip === undefined
          ? 'Choose a clip'
          : viewMode === 'rig'
            ? 'Rig view is showing the scene at rest'
            : undefined;

  return (
    <div className="scene-pane">
    <div
      ref={canvasEl}
      className="scene-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        resolveAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      }}
      onDragLeave={(e) => {
        // Moving between the wrapper and the canvas inside it fires
        // dragleave too; only a departure to something OUTSIDE counts.
        const to = e.relatedTarget;
        if (to instanceof Node && e.currentTarget.contains(to)) return;
        setTargetIfChanged(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const model = e.dataTransfer.getData('application/x-cuboidy-model');
        // Read before clearing: the preview and the commit must agree,
        // and the drop is the one moment they could disagree.
        const at = target;
        setTargetIfChanged(null);
        if (model !== '') onDropModel(model, at);
      }}
    >
      <ToolOverlay>
        <ToolBar
          value={tool}
          label="Scene tools"
          items={[
            {
              id: 'select',
              icon: MousePointer2,
              label: 'Select',
              unavailable: toolDisabled.select,
            },
            {
              id: 'move',
              icon: Move,
              label: 'Move',
              unavailable: toolDisabled.move,
            },
            {
              id: 'rotate',
              icon: Rotate3d,
              label: 'Rotate',
              unavailable: toolDisabled.rotate,
            },
          ]}
          onChange={onSetTool}
        />
      </ToolOverlay>
      <ViewOverlay>
        <ToggleGroup
          label="Selected-instance gizmos"
          items={[
            {
              id: 'origin',
              icon: Crosshair,
              label: "Show the selected model's origin",
              on: gizmos.origin,
            },
            {
              id: 'sockets',
              icon: Plug,
              label: 'Show the sockets it publishes',
              on: gizmos.sockets,
            },
            {
              id: 'frame',
              icon: Box,
              label: 'Show the selection outline',
              on: gizmos.frame,
            },
          ]}
          onToggle={onToggleGizmo}
        />
        <ViewToggle
          value={viewMode}
          label="View mode"
          items={[
            {
              id: 'rig',
              label: 'Rig view',
              title: 'The arrangement at rest, with animation out of the way',
            },
            {
              id: 'anim',
              label: 'Anim view',
              title: 'Play what the instances are set to play',
              unavailable: animUnavailable,
            },
          ]}
          onChange={onChangeViewMode}
        />
      </ViewOverlay>

      <Canvas
        flat
        camera={{ position: [reach * 2, reach * 1.6, reach * 2], fov: 35 }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#14161a']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 10, 8]} intensity={1.1} />
        <directionalLight position={[-8, 4, -6]} intensity={0.4} />
        <gridHelper args={[reach * 4, 16, '#2a2f38', '#20242b']} />
        <FrameCamera reach={reach} />
        <CaptureCamera into={view} />
        {dragModel !== null && target !== null && (
          <DropPreview model={dragModel} target={target} />
        )}
        {roots.map((n) => (
          <InstanceMesh
            key={n.placed.instance.id}
            node={n}
            selected={selected}
            hidden={hidden}
            gizmos={gizmos}
            register={register}
            onSelect={onSelect}
          />
        ))}
        {transformMode !== null && selectedPlaced !== null && (
          <TransformGizmoHost
            registry={objects}
            objectKey={selectedPlaced.instance.id}
            mode={transformMode}
            // Whole units: an instance is placed at voxel scale, and the
            // 0.5 step the editor uses for markers would be a finer grid
            // than anything in a scene is measured on. Shift still drops
            // to 0.1.
            snapCoarse={1}
            // Nothing to factor out. The gizmo attaches to the inner
            // group, whose parent is the socket (or the world), so its
            // local transform IS the stored placement — TransformControls
            // edits exactly the value that gets written. Before the
            // nesting this needed the world frame un-rotated back into
            // socket space on every commit.
            factorOutLeft={undefined}
            factorOutRight={undefined}
            onCommitPosition={(p) => onMove(selectedPlaced.instance.id, p)}
            onCommitRotation={(r) => onRotate(selectedPlaced.instance.id, r)}
          />
        )}
        <OrbitControls makeDefault />
      </Canvas>
      {placed.length === 0 && (
        <p className="scene-hint">
          Drag a model from the left, or double-click one, to put it in the
          scene.
        </p>
      )}
    </div>

    {/* Under the canvas, where the editor's has always been. A transport
        is not a tool overlay — it is a fixture of a view that can move. */}
    <Transport
      playing={clipPlaying}
      time={at}
      duration={clip?.duration ?? 0}
      {...(transportDisabled !== undefined && { disabled: transportDisabled })}
      onToggle={() => {
        if (selectedPlaced === null || anim === undefined) return;
        if (clipPlaying) {
          // Freeze where it is, so it stays there while other actors keep
          // moving on the shared clock.
          onSetAnim(selectedPlaced.instance.id, {
            ...anim,
            playing: false,
            at,
          });
        } else {
          onSeek(at);
          onSetAnim(selectedPlaced.instance.id, { ...anim, playing: true });
        }
      }}
      onScrub={(t) => {
        if (selectedPlaced === null || anim === undefined) return;
        // Playing: move the shared clock, so everything stays in step.
        // Paused: move this instance's own frozen point.
        if (clipPlaying) onSeek(t);
        else onSetAnim(selectedPlaced.instance.id, { ...anim, at: t });
      }}
    >
      <select
        className="anim-select"
        aria-label="Clip"
        value={anim?.clip ?? ''}
        disabled={selectedPlaced === null || clips.length === 0}
        onChange={(e) => {
          if (selectedPlaced === null) return;
          const next = e.target.value;
          // Choosing a clip starts it: picking one and then having to
          // press play is a step with no decision in it.
          onSetAnim(
            selectedPlaced.instance.id,
            next === '' ? null : { clip: next, playing: true },
          );
        }}
      >
        {/* An instance may play NOTHING — a static prop in a scene — which
            the editor has no equivalent of: its picker chooses among the
            clips a model has, and one of them is always active. Called
            "none" rather than "rest pose" because Rig view already owns
            that phrase for the whole scene, and two controls meaning
            almost the same thing should not share a word. */}
        <option value="">— none —</option>
        {clips.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Transport>
    </div>
  );
}

// One instance and everything hanging off it.
//
// The nesting is the point. A guest sits inside its host's group, behind
// the socket's own frame, so the host's transform carries it — including
// while a gizmo is mutating that transform imperatively mid-drag, which a
// sibling would not hear about until the drag committed.
//
// Two groups per instance, not one: the outer carries the model into the
// frame it belongs to (the world for a free instance, the socket for a
// guest), and the inner carries the PLACEMENT. Keeping them apart is what
// makes the inner group's local transform exactly the stored value, so a
// move commit is `target.position` with no conversion at all.
function InstanceMesh({
  node,
  selected,
  hidden,
  gizmos,
  register,
  onSelect,
}: {
  node: SceneNode;
  selected: string | null;
  hidden: ReadonlySet<string>;
  gizmos: SceneGizmos;
  register: (id: string, obj: Object3D | null) => void;
  onSelect: (id: string) => void;
}) {
  const placed = node.placed;
  const view = useMemo(() => {
    const geometry = viewGeometry(placed.model);
    if (geometry === null) return null;
    const partPalettes = new Map<string, Palette>();
    for (const [name, r] of placed.model.parts) partPalettes.set(name, r.palette);
    return {
      geometry,
      partPalettes,
      roots: buildRigTree(geometry, placed.model.manifest),
    };
  }, [placed.model]);
  const id = placed.instance.id;
  // Registration is unconditional on mount/unmount, so it must not sit
  // behind the `view === null` early return below.
  const ref = useCallback(
    (obj: Object3D | null) => {
      if (obj !== null) obj.userData['instanceId'] = id;
      register(id, obj);
    },
    [register, id],
  );

  // Where this instance's frame comes from. A nested guest measures from
  // the socket in its HOST MODEL's space — the host's group has already
  // put that space in the world. A root instance measures from the world
  // directly, which for an unresolved attachment means the frame
  // placeScene worked out rather than a host it could not find.
  const base = placed.attachAt;
  const outer: [number, number, number] = base === null ? [0, 0, 0] : [...base.pos];
  const outerQuat: [number, number, number, number] =
    base === null
      ? [0, 0, 0, 1]
      : [base.quat[0], base.quat[1], base.quat[2], base.quat[3]];
  const inner: [number, number, number] =
    base === null ? [...placed.frame.pos] : [...placed.instance.placement.pos];
  const innerQuat: [number, number, number, number] =
    base === null
      ? [
          placed.frame.quat[0],
          placed.frame.quat[1],
          placed.frame.quat[2],
          placed.frame.quat[3],
        ]
      : placementQuat(placed.instance.placement.rot);

  return (
    <group position={outer} quaternion={outerQuat}>
      <group
        ref={ref}
        position={inner}
        quaternion={innerQuat}
        onClick={(e) => {
          // An orbit or gizmo drag ends in a click too, and r3f's delta
          // (px moved between down and up) is what tells them apart.
          // RiggedParts guards its own part meshes, but a guarded click
          // does not stop propagating — so without this the drag would
          // bubble up here and change the selection out from under it.
          if (e.delta > 2) return;
          e.stopPropagation();
          onSelect(id);
        }}
      >
        {view !== null && !hidden.has(id) && (
          <>
            <RiggedParts
              roots={view.roots}
              palette={view.geometry.palette}
              partPalettes={view.partPalettes}
              poses={placed.poses}
              hiddenParts={EMPTY}
              selectedPart={null}
              gizmos={NO_PART_GIZMOS}
              onSelectPart={() => onSelect(id)}
            />
            {id === selected && (
              <InstanceGizmos model={placed.model} show={gizmos} />
            )}
          </>
        )}
        {node.children.map((c) => (
          <InstanceMesh
            key={c.placed.instance.id}
            node={c}
            selected={selected}
            hidden={hidden}
            gizmos={gizmos}
            register={register}
            onSelect={onSelect}
          />
        ))}
      </group>
    </group>
  );
}

function placementQuat(
  rot: readonly [number, number, number] | undefined,
): [number, number, number, number] {
  if (rot === undefined) return [0, 0, 0, 1];
  const q = quatFromEulerZXYDeg(rot);
  return [q[0], q[1], q[2], q[3]];
}

// A resolved model as the geometry-shaped view @cuboidy/ui takes. `palette`
// is only the fallback — per-part colors come from `partPalettes`, since a
// part's colors are its own (§7.4 / §6.13).
function viewGeometry(model: LibraryModel): Geometry | null {
  const parts = [...model.parts.values()];
  if (parts.length === 0) return null;
  return {
    palette: parts[0]?.palette ?? [],
    parts: parts.map((r) => r.part),
  };
}

// Hands the camera out to the DOM side, which needs it to turn a
// dragover's client coordinates into a point in the scene. Inside the
// Canvas because that is the only place r3f's context exists.
function CaptureCamera({ into }: { into: { current: Camera | null } }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    into.current = camera;
    return () => {
      into.current = null;
    };
  }, [camera, into]);
  return null;
}

// `<Canvas camera={...}>` is read once, at mount — and at mount the scene
// is empty, so the framing was computed for nothing and never revisited.
// The first model then appeared with the camera inside it. This reframes
// when the scene's extent GROWS, which is the moment the old framing stops
// containing it; shrinking is left alone so removing one model does not
// yank the view the user has since orbited to.
function FrameCamera({ reach }: { reach: number }) {
  const camera = useThree((s) => s.camera);
  const framed = useRef(0);
  useEffect(() => {
    if (reach <= framed.current) return;
    framed.current = reach;
    camera.position.set(reach * 1.6, reach * 1.3, reach * 1.6);
    camera.lookAt(0, reach * 0.35, 0);
    camera.updateProjectionMatrix();
  }, [reach, camera]);
  return null;
}

const EMPTY: ReadonlySet<string> = new Set();
// Per-PART gizmos stay off: a scene selects models, not their parts, and
// the model-level overlays are InstanceGizmos' job.
const NO_PART_GIZMOS = { pivot: false, sockets: false, frame: false } as const;
