import { useEffect, useMemo } from 'react';
import { publishedSocketFrames } from '@cuboidy/core';
import {
  GIZMO_FRAME_COLOR as FRAME_COLOR,
  GIZMO_MARKER_COLOR as ORIGIN_COLOR,
  GIZMO_SOCKET_COLOR as SOCKET_COLOR,
  axisCross,
  noRaycast,
} from '@cuboidy/three';
import { BoxGeometry, EdgesGeometry } from 'three';
import type { LibraryModel } from '../lib/library.js';
import { modelBounds } from '../lib/bounds.js';
import type { SceneGizmos } from '../lib/view.js';

interface Props {
  model: LibraryModel;
  show: SceneGizmos;
}

// The selected instance's overlays, drawn in the MODEL's own space —
// inside the group that already carries the instance's world frame, so
// they ride it for free, including a guest carried by a moving socket.
//
// The editor's counterpart (PartGizmos) draws a PART: its pivot, the
// sockets it declares, its box. This draws a MODEL: the origin a socket
// puts it on (§6.12), the sockets it PUBLISHES, its whole outline. Same
// three toggles, same colors, one level up — because that is the level a
// scene works at. Sharing the component instead would have meant one of
// the two lying about what it shows.
//
// Every material skips the depth test: the origin cross sits inside the
// mesh and the outline lies on its surface, so draw-on-top is the only
// readable option.

export function InstanceGizmos({ model, show }: Props) {
  const box = useMemo(() => modelBounds(model), [model]);
  // Marker size tracks the model, so a 4-voxel gem and a 40-voxel knight
  // both read.
  const r = useMemo(() => {
    const s = box?.size ?? [8, 8, 8];
    return Math.min(1.2, Math.max(0.25, Math.max(s[0]!, s[1]!, s[2]!) * 0.05));
  }, [box]);

  const frameGeom = useMemo(() => {
    if (box === null) return null;
    const b = new BoxGeometry(box.size[0], box.size[1], box.size[2]);
    const edges = new EdgesGeometry(b);
    b.dispose();
    return edges;
  }, [box]);
  useEffect(() => () => frameGeom?.dispose(), [frameGeom]);

  const axesGeom = useMemo(() => axisCross(r * 3), [r]);
  useEffect(() => () => axesGeom.dispose(), [axesGeom]);
  const socketAxesGeom = useMemo(() => axisCross(r * 2), [r]);
  useEffect(() => () => socketAxesGeom.dispose(), [socketAxesGeom]);

  // Where each published name actually resolves to. At rest: the markers
  // say what the model OFFERS, which does not change with the clock.
  const sockets = useMemo(
    () =>
      [...publishedSocketFrames(model.manifest, model.parts)].map(
        ([name, frame]) => ({ name, frame }),
      ),
    [model],
  );

  return (
    <>
      {show.frame && frameGeom !== null && box !== null && (
        <lineSegments
          geometry={frameGeom}
          position={box.center}
          renderOrder={998}
          raycast={noRaycast}
        >
          <lineBasicMaterial
            color={FRAME_COLOR}
            depthTest={false}
            transparent
            opacity={0.9}
          />
        </lineSegments>
      )}

      {/* The model origin: the point a socket puts on the socket (§6.12),
          and so the point a placement offset is measured from. */}
      {show.origin && (
        <group raycast={noRaycast}>
          <lineSegments geometry={axesGeom} renderOrder={1000} raycast={noRaycast}>
            <lineBasicMaterial vertexColors depthTest={false} transparent />
          </lineSegments>
          <mesh renderOrder={1000} raycast={noRaycast}>
            <sphereGeometry args={[r * 0.7, 16, 12]} />
            <meshBasicMaterial
              color={ORIGIN_COLOR}
              depthTest={false}
              transparent
            />
          </mesh>
        </group>
      )}

      {show.sockets &&
        sockets.map(({ name, frame }) => (
          <group
            key={name}
            position={frame.pos}
            quaternion={[
              frame.quat[0],
              frame.quat[1],
              frame.quat[2],
              frame.quat[3],
            ]}
          >
            <mesh renderOrder={999} raycast={noRaycast}>
              <octahedronGeometry args={[r * 0.9]} />
              <meshBasicMaterial
                color={SOCKET_COLOR}
                depthTest={false}
                transparent
                opacity={0.95}
              />
            </mesh>
            {/* The axes matter here in a way they don't on a part socket:
                a guest's own axes align to this frame, so which way it
                points IS how the guest will sit. */}
            <lineSegments
              geometry={socketAxesGeom}
              renderOrder={999}
              raycast={noRaycast}
            >
              <lineBasicMaterial vertexColors depthTest={false} transparent />
            </lineSegments>
          </group>
        ))}
    </>
  );
}
