import { useMemo } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Cvox, Manifest, ManifestPart } from '@cuboidy/core';
import type { ViewMode } from '../lib/types.js';
import { PartMesh } from './PartMesh.js';

interface Props {
  cvox: Cvox;
  // Required position so the App can pass `manifest: undefined` directly
  // under `exactOptionalPropertyTypes: true` (the strict optional rule
  // forbids omit-OR-undefined slots without explicit `| undefined`).
  manifest: Manifest | undefined;
  viewMode: ViewMode;
  hiddenParts: ReadonlySet<string>;
}

// Renders the model in one of two modes:
//   - Cvox view: every part sits at world origin [0,0,0], the literal
//     .cvox-local convention. Multi-part files overlap; the sidebar
//     visibility toggles are the way to peel layers.
//   - Rig view: parts are positioned per the manifest's parent chain
//     and position offsets. The assembled model takes shape — e.g.
//     wolf's head sits above-and-behind body instead of overlapping.
// Rig view requires a manifest; the view toggle disables rig when
// none is loaded.
//
// Camera target / radius are computed from the full cvox bounding box,
// not the visible subset, so toggling visibility doesn't make the camera
// jump. (drei OrbitControls re-snaps to a changed `target` prop.)

export function VoxelScene({ cvox, manifest, viewMode, hiddenParts }: Props) {
  const visibleParts = cvox.parts.filter((p) => !hiddenParts.has(p.name));

  const positions = useMemo(() => computePartPositions(cvox, manifest, viewMode), [
    cvox,
    manifest,
    viewMode,
  ]);

  const target = useMemo<[number, number, number]>(
    () => computeSceneCenter(cvox, manifest, viewMode),
    [cvox, manifest, viewMode],
  );

  const radius = useMemo(() => {
    const span = computeSceneSpan(cvox, manifest, viewMode);
    return Math.max(span.w, span.h, span.d) * 1.8;
  }, [cvox, manifest, viewMode]);

  const gridSize = useMemo(() => {
    const raw = Math.max(
      20,
      Math.ceil(Math.max(...cvox.parts.map((p) => Math.max(p.size.w, p.size.d)))) + 4,
    );
    return raw + (raw % 2);
  }, [cvox]);

  return (
    <Canvas
      camera={{ position: [radius, radius, radius], fov: 50 }}
      shadows={false}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <gridHelper
        args={[gridSize, gridSize]}
        position={[gridSize / 2, 0, gridSize / 2]}
      />
      {visibleParts.map((part) => {
        const pos = positions.get(part.name) ?? [0, 0, 0];
        return (
          <group key={part.name} position={pos}>
            <PartMesh part={part} palette={cvox.palette} />
          </group>
        );
      })}
      <OrbitControls target={target} makeDefault />
    </Canvas>
  );
}

// Computes a position offset for each part. Cvox view returns [0,0,0]
// for all parts (origin-stacked). Rig view walks the manifest parent
// chain and accumulates positions.
//
// Manifest position semantics (SPEC §3.3, §4): a part's `position` is
// its placement RELATIVE TO ITS PARENT'S ORIGIN. Walking parent→child
// and summing positions gives the world-space placement. Parts without
// a parent (root parts) place their position directly in world space.
function computePartPositions(
  cvox: Cvox,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  if (viewMode === 'cvox' || manifest === undefined) {
    for (const p of cvox.parts) out.set(p.name, [0, 0, 0]);
    return out;
  }
  // Build name → manifest part index.
  const mpByName = new Map<string, ManifestPart>();
  for (const mp of manifest.parts) mpByName.set(mp.name, mp);

  // Resolve each part's world position via parent-chain accumulation.
  // Memoize to avoid recomputing shared ancestors. Parts missing from
  // the manifest fall back to origin (cross-file lint warns separately).
  const resolved = new Map<string, [number, number, number]>();
  const resolve = (name: string): [number, number, number] => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    const mp = mpByName.get(name);
    if (mp === undefined) {
      const zero: [number, number, number] = [0, 0, 0];
      resolved.set(name, zero);
      return zero;
    }
    const local = mp.position ?? [0, 0, 0];
    if (mp.parent === undefined) {
      resolved.set(name, [local[0], local[1], local[2]]);
      return [local[0], local[1], local[2]];
    }
    const parentPos = resolve(mp.parent);
    const world: [number, number, number] = [
      parentPos[0] + local[0],
      parentPos[1] + local[1],
      parentPos[2] + local[2],
    ];
    resolved.set(name, world);
    return world;
  };
  for (const p of cvox.parts) out.set(p.name, resolve(p.name));
  return out;
}

interface Span {
  w: number;
  h: number;
  d: number;
}

function computeSceneSpan(
  cvox: Cvox,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): Span {
  if (viewMode === 'cvox' || manifest === undefined) {
    return {
      w: Math.max(1, ...cvox.parts.map((p) => p.size.w)),
      h: Math.max(1, ...cvox.parts.map((p) => p.size.h)),
      d: Math.max(1, ...cvox.parts.map((p) => p.size.d)),
    };
  }
  const positions = computePartPositions(cvox, manifest, viewMode);
  let minX = 0;
  let minY = 0;
  let minZ = 0;
  let maxX = 1;
  let maxY = 1;
  let maxZ = 1;
  for (const p of cvox.parts) {
    const pos = positions.get(p.name) ?? [0, 0, 0];
    minX = Math.min(minX, pos[0]);
    minY = Math.min(minY, pos[1]);
    minZ = Math.min(minZ, pos[2]);
    maxX = Math.max(maxX, pos[0] + p.size.w);
    maxY = Math.max(maxY, pos[1] + p.size.h);
    maxZ = Math.max(maxZ, pos[2] + p.size.d);
  }
  return { w: maxX - minX, h: maxY - minY, d: maxZ - minZ };
}

function computeSceneCenter(
  cvox: Cvox,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): [number, number, number] {
  if (viewMode === 'cvox' || manifest === undefined) {
    const maxW = Math.max(1, ...cvox.parts.map((p) => p.size.w));
    const maxH = Math.max(1, ...cvox.parts.map((p) => p.size.h));
    const maxD = Math.max(1, ...cvox.parts.map((p) => p.size.d));
    return [maxW / 2, maxH / 2, maxD / 2];
  }
  const positions = computePartPositions(cvox, manifest, viewMode);
  let minX = 0;
  let minY = 0;
  let minZ = 0;
  let maxX = 1;
  let maxY = 1;
  let maxZ = 1;
  for (const p of cvox.parts) {
    const pos = positions.get(p.name) ?? [0, 0, 0];
    minX = Math.min(minX, pos[0]);
    minY = Math.min(minY, pos[1]);
    minZ = Math.min(minZ, pos[2]);
    maxX = Math.max(maxX, pos[0] + p.size.w);
    maxY = Math.max(maxY, pos[1] + p.size.h);
    maxZ = Math.max(maxZ, pos[2] + p.size.d);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}
