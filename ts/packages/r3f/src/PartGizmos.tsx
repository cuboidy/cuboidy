import { useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { quatFromEulerZXYDeg, type Part } from '@cuboidy/core';
import { BoxGeometry, EdgesGeometry, Mesh, type Object3D } from 'three';
import {
  GIZMO_FRAME_COLOR as FRAME_COLOR,
  GIZMO_MARKER_COLOR as PIVOT_COLOR,
  GIZMO_SOCKET_ACTIVE_COLOR as SOCKET_ACTIVE_COLOR,
  GIZMO_SOCKET_COLOR as SOCKET_COLOR,
  axisCross,
  noRaycast,
} from '@cuboidy/three';
import type { GizmoVisibility, TransformSubTarget } from './view-types.js';

// Transform-tool integration, non-null while a transform
// tool is active. Pivot / socket markers become click targets that pick
// the gizmo's sub-target, and each registers its Object3D ('pivot' /
// 'socket:<name>') for the gizmo host to attach TransformControls to.
export interface GizmoPicking {
  // Whether the pivot marker can be picked as the gizmo's sub-target.
  // Both transform tools offer it: move edits pivot.pos (compensated so
  // the render doesn't shift), rotate edits pivot.rot.
  pivotPickable: boolean;
  active: TransformSubTarget;
  onPick: (sub: TransformSubTarget) => void;
  register: (key: string, obj: Object3D | null) => void;
}

interface Props {
  part: Part;
  show: GizmoVisibility;
  picking: GizmoPicking | null;
  // Geometry view only: rotate the pivot marker (axes cross) by pivot.rot
  // itself. The rig view leaves this off — its ancestor group already
  // carries q_rotation ⊗ q_pivot, so applying it here would double up.
  // This is also what makes pivot ROTATION editable in the geometry view:
  // the marker's own orientation is the live preview there.
  applyPivotRot?: boolean | undefined;
}

// Selection gizmos for one part, drawn in the part's LOCAL voxel frame
// (the [0..w]×[0..h]×[0..d] box the part's voxels live in). Rendering
// them inside the same group as the PartMesh means every view (geometry /
// rig / anim) carries them through its own transforms for free —
// including animated scale, where the frame keeps hugging the scaled
// geometry while the pivot marker stays put (the pivot is the scale
// center).
//
// All materials skip the depth test: the pivot usually sits INSIDE the
// mesh and the frame lies exactly ON its surface (z-fighting), so
// draw-on-top is the only readable option. `transparent` routes them
// through the late render pass where renderOrder layers markers above
// the frame.

// An active pivot marker takes the accent, like the frame.
const PIVOT_ACTIVE_COLOR = FRAME_COLOR;

// With no transform tool active, gizmos are overlay-only (the shared
// noRaycast). With a tool active, the pickable markers switch back to
// the real Mesh raycast explicitly (assigning `undefined` would break
// it, so both states are explicit functions).
const meshRaycast = Mesh.prototype.raycast;

export function PartGizmos({ part, show, picking, applyPivotRot }: Props) {
  const { w, h, d } = part.size;
  // Marker size tracks the part so gizmos read the same on a 4³ hand
  // and a 30-voxel torso.
  const r = Math.min(0.6, Math.max(0.18, Math.max(w, h, d) * 0.05));

  const frameGeom = useMemo(() => {
    const box = new BoxGeometry(w, h, d);
    const edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [w, h, d]);
  useEffect(() => () => frameGeom.dispose(), [frameGeom]);

  const axesGeom = useMemo(() => axisCross(r * 3), [r]);
  useEffect(() => () => axesGeom.dispose(), [axesGeom]);

  const piv = part.pivot.pos;
  const pivotPickable = picking !== null && picking.pivotPickable;
  const pivotActive = picking?.active.kind === 'pivot';
  const pivotQuat = useMemo<[number, number, number, number] | undefined>(() => {
    const rot = part.pivot.rot;
    if (applyPivotRot !== true || rot === undefined) return undefined;
    const q = quatFromEulerZXYDeg([rot.x, rot.y, rot.z]);
    return [q[0], q[1], q[2], q[3]];
  }, [applyPivotRot, part.pivot.rot]);
  return (
    <>
      {show.frame && (
        <lineSegments
          geometry={frameGeom}
          position={[w / 2, h / 2, d / 2]}
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
      {show.pivot && (
        <group
          position={[piv.x, piv.y, piv.z]}
          {...(pivotQuat !== undefined && { quaternion: pivotQuat })}
          ref={(obj: Object3D | null) => picking?.register('pivot', obj)}
        >
          <lineSegments geometry={axesGeom} renderOrder={1000} raycast={noRaycast}>
            <lineBasicMaterial vertexColors depthTest={false} transparent />
          </lineSegments>
          <mesh renderOrder={1000} scale={pivotActive ? 1.3 : 1} raycast={noRaycast}>
            <sphereGeometry args={[r * 0.75, 16, 12]} />
            <meshBasicMaterial
              color={pivotActive ? PIVOT_ACTIVE_COLOR : PIVOT_COLOR}
              depthTest={false}
              transparent
            />
          </mesh>
          {/* Invisible, oversized pick target. The visible sphere stays
              raycast-transparent; part-body click handlers yield to any
              intersection tagged gizmoMarker (the marker usually sits
              INSIDE the part mesh, which the ray reaches first).
              Clicking TOGGLES pivot-move mode: a second click returns
              the gizmo to the part body. */}
          {pivotPickable && (
            <mesh
              visible={false}
              raycast={meshRaycast}
              userData={{ gizmoMarker: true }}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                if (e.delta > 2) return;
                e.stopPropagation();
                picking!.onPick(
                  pivotActive ? { kind: 'part' } : { kind: 'pivot' },
                );
              }}
            >
              <sphereGeometry args={[r * 1.4, 8, 6]} />
            </mesh>
          )}
        </group>
      )}
      {show.sockets &&
        part.sockets.map((s) => {
          const active =
            picking?.active.kind === 'socket' &&
            picking.active.socket === s.name;
          // The marker's quaternion carries socket.rot so a rotate drag
          // composes on top of the stored value (the octahedron itself
          // is visually orientation-neutral).
          const q =
            s.rot === undefined
              ? undefined
              : quatFromEulerZXYDeg([s.rot.x, s.rot.y, s.rot.z]);
          return (
            <group key={s.name}>
              <mesh
                position={[s.pos.x, s.pos.y, s.pos.z]}
                {...(q !== undefined && {
                  quaternion: [q[0], q[1], q[2], q[3]] as [
                    number,
                    number,
                    number,
                    number,
                  ],
                })}
                renderOrder={999}
                scale={active ? 1.35 : 1}
                raycast={noRaycast}
                ref={(obj: Object3D | null) =>
                  picking?.register(`socket:${s.name}`, obj)
                }
              >
                <octahedronGeometry args={[r * 0.9]} />
                <meshBasicMaterial
                  color={active ? SOCKET_ACTIVE_COLOR : SOCKET_COLOR}
                  depthTest={false}
                  transparent
                  opacity={0.95}
                />
              </mesh>
              {/* Oversized invisible pick target — see the pivot's.
                  Click toggles socket-move mode on/off. */}
              {picking !== null && (
                <mesh
                  position={[s.pos.x, s.pos.y, s.pos.z]}
                  visible={false}
                  raycast={meshRaycast}
                  userData={{ gizmoMarker: true }}
                  onClick={(e: ThreeEvent<MouseEvent>) => {
                    if (e.delta > 2) return;
                    e.stopPropagation();
                    picking.onPick(
                      active
                        ? { kind: 'part' }
                        : { kind: 'socket', socket: s.name },
                    );
                  }}
                >
                  <sphereGeometry args={[r * 1.5, 8, 6]} />
                </mesh>
              )}
            </group>
          );
        })}
    </>
  );
}
