import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Geometry, Palette } from '@cuboidy/core';
import { RiggedParts, buildRigTree, computeSceneSpan } from '@cuboidy/ui';
import type { LibraryModel } from '../lib/library.js';
import type { PlacedInstance } from '../lib/scene.js';

interface Props {
  placed: readonly PlacedInstance[];
  onSelect: (id: string | null) => void;
  // Dropping a library row onto the canvas adds it to the scene.
  onDropModel: (model: string) => void;
}

// The scene: every placed instance, each at the world frame the scene
// layer resolved for it.
//
// An attached guest is drawn inside a <group> at its socket frame, so it
// simply IS where the socket is — the same three.js nesting the rig itself
// uses for parts. Nothing here recomputes an attachment; SPEC §7.8 / §6.12
// live in core and the scene layer applies them once.
export function SceneView({ placed, onSelect, onDropModel }: Props) {
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

  return (
    <div
      className="scene-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const model = e.dataTransfer.getData('application/x-cuboidy-model');
        if (model !== '') onDropModel(model);
      }}
    >
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
        {placed.map((p) => (
          <InstanceMesh
            key={p.instance.id}
            placed={p}
            onSelect={() => onSelect(p.instance.id)}
          />
        ))}
        <OrbitControls makeDefault />
      </Canvas>
      {placed.length === 0 && (
        <p className="scene-hint">
          Drag a model from the left, or double-click one, to put it in the
          scene.
        </p>
      )}
    </div>
  );
}

function InstanceMesh({
  placed,
  onSelect,
}: {
  placed: PlacedInstance;
  onSelect: () => void;
}) {
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
  if (view === null) return null;

  const [x, y, z] = placed.frame.pos;
  const q = placed.frame.quat;
  return (
    <group
      position={[x, y, z]}
      quaternion={[q[0], q[1], q[2], q[3]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <RiggedParts
        roots={view.roots}
        palette={view.geometry.palette}
        partPalettes={view.partPalettes}
        poses={null}
        hiddenParts={EMPTY}
        selectedPart={null}
        gizmos={NO_GIZMOS}
        onSelectPart={onSelect}
      />
    </group>
  );
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

const EMPTY: ReadonlySet<string> = new Set();
const NO_GIZMOS = { pivot: false, sockets: false, frame: false } as const;
