import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Geometry, Palette } from '@cuboidy/core';
import {
  RiggedParts,
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '@cuboidy/ui';
import type { LibraryModel } from '../lib/library.js';

interface Props {
  model: LibraryModel | null;
}

// One model in rest pose. Stage 1 of the workspace: before anything can be
// placed or attached, the thing being placed has to be visible.
//
// The rig, the meshes and the camera framing are all @cuboidy/ui — the
// same components the editor draws with, so a model looks identical in
// both. What this file owns is only the bridge from a resolved model
// (SPEC §6.13 parts) to the geometry-shaped view those components take.
export function ModelView({ model }: Props) {
  const view = useMemo(() => {
    if (model === null) return null;
    const parts = [...model.parts.values()];
    if (parts.length === 0) return null;
    // A part's colors are its own (§7.4 / §6.13): its file's, or whatever
    // the manifest resolved for an inline one. `palette` is only the
    // fallback for anything the per-part map misses.
    const partPalettes = new Map<string, Palette>();
    for (const [name, r] of model.parts) partPalettes.set(name, r.palette);
    const geometry: Geometry = {
      palette: parts[0] === undefined ? [] : (model.parts.values().next().value?.palette ?? []),
      parts: parts.map((r) => r.part),
    };
    return {
      roots: buildRigTree(geometry, model.manifest),
      geometry,
      partPalettes,
    };
  }, [model]);

  if (model === null) {
    return <p className="empty">Select a model to view it.</p>;
  }
  if (view === null) {
    return <p className="empty">{model.dir} has no parts to draw.</p>;
  }

  // 'rig' framing: parts placed by the manifest, which is what a scene
  // will always show. ('geometry' framing stacks every part at the origin
  // — an editor affordance with no meaning here.)
  const span = computeSceneSpan(view.geometry, model.manifest, 'rig');
  const center = computeSceneCenter(view.geometry, model.manifest, 'rig');
  const reach = Math.max(span.w, span.h, span.d, 1);
  const distance = reach * 2.2;

  return (
    <Canvas
      // `flat` + no tone mapping: voxel colors are authored as the exact
      // sRGB the palette names, and the editor renders them that way.
      flat
      camera={{ position: [distance, distance * 0.8, distance], fov: 35 }}
      key={model.dir}
    >
      <color attach="background" args={['#14161a']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 10, 8]} intensity={1.1} />
      <directionalLight position={[-8, 4, -6]} intensity={0.4} />
      <group position={[-center[0], -center[1], -center[2]]}>
        <RiggedParts
          roots={view.roots}
          palette={view.geometry.palette}
          partPalettes={view.partPalettes}
          poses={null}
          hiddenParts={EMPTY}
          selectedPart={null}
          gizmos={NO_GIZMOS}
          onSelectPart={noop}
        />
      </group>
      <gridHelper
        args={[Math.max(span.w, span.d) * 2, 10, '#2a2f38', '#20242b']}
        position={[0, -center[1], 0]}
      />
      <OrbitControls makeDefault />
    </Canvas>
  );
}

const EMPTY: ReadonlySet<string> = new Set();
const NO_GIZMOS = { pivot: false, sockets: false, frame: false } as const;
const noop = (): void => {};
