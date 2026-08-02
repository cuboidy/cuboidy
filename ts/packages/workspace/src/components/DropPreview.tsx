import { useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, EdgesGeometry, type LineSegments } from 'three';
import type { LibraryModel } from '../lib/library.js';
import { modelBounds } from '../lib/bounds.js';
import type { DropTarget } from '../lib/drop.js';

interface Props {
  model: LibraryModel;
  target: DropTarget;
}

// Where the dragged model will land, drawn as its own outline at exactly
// the frame it will occupy.
//
// One mechanism for both outcomes. A socket drop and a ground drop differ
// only in which frame the box sits in, so showing them the same way is
// both less code and less to learn — you are always being shown the model
// where it is going, never a symbol that stands for it.
//
// The box is the model's REST bounds, so it is the same outline the
// selection frame will draw a moment later. Seeing the shape you dragged
// become the shape that is selected is the whole point of previewing.
//
// DASHED, though, and the selection frame is solid. They are the same
// colour and often the same size, and with a model already selected the
// screen otherwise carries two identical violet boxes with no way to tell
// which one is the thing about to happen. Dashed also says the right
// thing on its own: provisional, not yet real.

const PREVIEW_COLOR = 0x8338ec; // --accent, as the selection frame
// The editor turns an ACTIVE socket white; the resting ones stay amber.
// Same convention here, so "the one being targeted" looks the same in
// both apps.
const SOCKET_ACTIVE = 0xffffff;

const noRaycast = () => null;

export function DropPreview({ model, target }: Props) {
  const box = useMemo(() => modelBounds(model), [model]);
  const outline = useRef<LineSegments>(null);

  const geom = useMemo(() => {
    if (box === null) return null;
    const b = new BoxGeometry(box.size[0], box.size[1], box.size[2]);
    const edges = new EdgesGeometry(b);
    b.dispose();
    return edges;
  }, [box]);
  useEffect(() => () => geom?.dispose(), [geom]);

  // A dashed material draws nothing without this: the dash pattern is
  // measured along a per-vertex distance attribute that only exists once
  // it has been computed.
  useEffect(() => {
    outline.current?.computeLineDistances();
  }, [geom]);

  if (box === null || geom === null) return null;

  const scale = Math.max(box.size[0], box.size[1], box.size[2]);

  // The model ORIGIN goes at the target (§6.12), and the bounds are
  // measured from that origin — so the box centre is the target plus the
  // bounds centre, carried into the target's orientation.
  const pos: [number, number, number] =
    target.kind === 'ground' ? target.pos : [...target.frame.pos];
  const quat: [number, number, number, number] =
    target.kind === 'ground'
      ? [0, 0, 0, 1]
      : [
          target.frame.quat[0],
          target.frame.quat[1],
          target.frame.quat[2],
          target.frame.quat[3],
        ];

  return (
    <group position={pos} quaternion={quat}>
      <lineSegments
        ref={outline}
        geometry={geom}
        position={box.center}
        renderOrder={1001}
        raycast={noRaycast}
      >
        {/* Dash length tracks the model, so a 4-voxel gem and a 40-voxel
            knight both read as dashed rather than one as solid and the
            other as four corners. */}
        <lineDashedMaterial
          color={PREVIEW_COLOR}
          dashSize={scale * 0.06}
          gapSize={scale * 0.04}
          depthTest={false}
          transparent
          opacity={0.95}
        />
      </lineSegments>
      {target.kind === 'socket' ? (
        // The socket it will hang from, lit up: white and clearly larger
        // than the amber resting marker underneath it, so it reads as
        // "this one" among however many the host publishes.
        <mesh renderOrder={1002} raycast={noRaycast}>
          {/* Clamped at both ends: it marks a point on the HOST, so a
              huge model being dropped must not grow it into a blob and a
              tiny one must not shrink it out of sight. */}
          <octahedronGeometry args={[Math.min(2, Math.max(0.9, scale * 0.08))]} />
          <meshBasicMaterial
            color={SOCKET_ACTIVE}
            depthTest={false}
            transparent
            opacity={0.9}
          />
        </mesh>
      ) : (
        // A footprint on the ground. Without it a box floating in a 3D
        // view has no readable height — this is the line that says the
        // model is standing on the floor rather than hovering.
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={1000}
          raycast={noRaycast}
        >
          <ringGeometry
            args={[
              Math.max(box.size[0], box.size[2]) * 0.5,
              Math.max(box.size[0], box.size[2]) * 0.5 + 0.35,
              48,
            ]}
          />
          <meshBasicMaterial
            color={PREVIEW_COLOR}
            depthTest={false}
            transparent
            opacity={0.8}
          />
        </mesh>
      )}
    </group>
  );
}
