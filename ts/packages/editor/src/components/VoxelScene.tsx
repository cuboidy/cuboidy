import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Cvox } from '@cuboidy/core';
import { PartMesh } from './PartMesh.js';

interface Props {
  cvox: Cvox;
}

// Lays out parts side-by-side along +X with a 1-voxel gap. Without a
// manifest (cuboidy.json) we don't know the rig hierarchy, so we can't
// place parts at their semantic offsets — overlapping all parts at the
// origin would be unreadable for multi-part models like wolf. Manifest-
// aware layout is a follow-up for A1.1.

const GAP = 1;

export function VoxelScene({ cvox }: Props) {
  const placements: Array<{ key: string; x: number; part: Cvox['parts'][number] }> = [];
  let xCursor = 0;
  for (const part of cvox.parts) {
    placements.push({ key: part.name, x: xCursor, part });
    xCursor += part.size.w + GAP;
  }

  // Camera placement — back away from the combined bounding box so
  // the whole arrangement is in frame on first load. Heuristic: the
  // largest dimension among (sum of widths + gaps, max height, max
  // depth) determines a comfortable orbit radius.
  const maxH = Math.max(1, ...cvox.parts.map((p) => p.size.h));
  const maxD = Math.max(1, ...cvox.parts.map((p) => p.size.d));
  const radius = Math.max(xCursor, maxH, maxD) * 1.5;
  const target: [number, number, number] = [xCursor / 2, maxH / 2, maxD / 2];

  return (
    <Canvas
      camera={{ position: [radius, radius, radius], fov: 50 }}
      shadows={false}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <gridHelper args={[Math.max(20, xCursor + 4), Math.max(20, xCursor + 4)]} />
      {placements.map(({ key, x, part }) => (
        <group key={key} position={[x, 0, 0]}>
          <PartMesh part={part} palette={cvox.palette} />
        </group>
      ))}
      <OrbitControls target={target} makeDefault />
    </Canvas>
  );
}
