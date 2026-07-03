import { useMemo } from 'react';
import { Euler, MathUtils, Quaternion } from 'three';
import type { Palette, Pose } from '@cuboidy/core';
import type { RigNode } from '../lib/rig.js';
import { PartMesh } from './PartMesh.js';

interface Props {
  roots: readonly RigNode[];
  palette: Palette;
  // Per-part sampled poses. `null` → rest pose for every part (the static
  // rig). A part absent from the map also falls back to rest.
  poses: Map<string, Pose> | null;
  hiddenParts: ReadonlySet<string>;
  // Per-part palette override (SPEC §6.10): with no manifest binding,
  // each part resolves against its DEFINING file's inline palette.
  // Absent = every part uses `palette`.
  partPalettes?: ReadonlyMap<string, Palette> | undefined;
}

// Renders the rig forest as nested three.js groups so a parent's animated
// transform carries its whole subtree (SPEC §6.2 rigid hierarchy). Each
// part-group's transform reproduces the SPEC §7.7 formula
//   v_parent = part.position + anim.pos + M_pivot·M_anim·S_anim·(v_local − pivot.pos)
// by placing the group at part.position+anim.pos (so the group origin IS the
// part's pivot), rotating/scaling there, and offsetting the mesh by −pivot.
export function RiggedParts({
  roots,
  palette,
  poses,
  hiddenParts,
  partPalettes,
}: Props) {
  return (
    <>
      {roots.map((node) => (
        <RigNodeView
          key={node.part.name}
          node={node}
          palette={palette}
          poses={poses}
          hiddenParts={hiddenParts}
          partPalettes={partPalettes}
        />
      ))}
    </>
  );
}

const REST_POSE: Pose = {
  rot: [0, 0, 0],
  pos: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
};

interface NodeProps {
  node: RigNode;
  palette: Palette;
  poses: Map<string, Pose> | null;
  hiddenParts: ReadonlySet<string>;
  partPalettes?: ReadonlyMap<string, Palette> | undefined;
}

function RigNodeView({
  node,
  palette,
  poses,
  hiddenParts,
  partPalettes,
}: NodeProps) {
  const part = node.part;
  const pose = poses?.get(part.name) ?? REST_POSE;
  const base = node.manifestPart?.position ?? [0, 0, 0];
  const piv = part.pivot.pos;
  const pivotRot = part.pivot.rot;

  const groupPos = useMemo<[number, number, number]>(
    () => [
      base[0] + pose.pos[0],
      base[1] + pose.pos[1],
      base[2] + pose.pos[2],
    ],
    [base, pose.pos],
  );

  // q_total = q_pivot · q_anim (SPEC §7.7): the animation rotation is applied
  // first in the rest-local frame, then the pivot's rest rotation. Euler order
  // ZXY intrinsic (§4), degrees → radians. three.js is right-handed like the
  // native frame, so no handedness flip (that's Unity-only, §4).
  const quaternion = useMemo<[number, number, number, number]>(() => {
    const q = new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(pose.rot[0]),
        MathUtils.degToRad(pose.rot[1]),
        MathUtils.degToRad(pose.rot[2]),
        'ZXY',
      ),
    );
    if (pivotRot !== undefined) {
      const qPivot = new Quaternion().setFromEuler(
        new Euler(
          MathUtils.degToRad(pivotRot.x),
          MathUtils.degToRad(pivotRot.y),
          MathUtils.degToRad(pivotRot.z),
          'ZXY',
        ),
      );
      qPivot.multiply(q);
      return [qPivot.x, qPivot.y, qPivot.z, qPivot.w];
    }
    return [q.x, q.y, q.z, q.w];
  }, [pose.rot, pivotRot]);

  const meshVisible = pose.visible && !hiddenParts.has(part.name);

  return (
    // Outer group carries position + rotation only: child PART groups are
    // siblings of the scale group below, so they attach at this part's pivot
    // (the outer group origin) and ride its position/rotation — but are NOT
    // scaled by this part's animated scale (SPEC §7.7 scopes S_anim to the
    // part's own (v_local − pivot.pos), and §6.2 places children at the
    // pivot in parent space).
    <group position={groupPos} quaternion={quaternion}>
      {/* Scale group: applies S_anim. The −pivot offset lives INSIDE it so
          the scale is centered on pivot.pos (scaling (v_local − pivot.pos),
          not (v_local) − pivot). At rest scale [1,1,1] this is a no-op. */}
      <group scale={pose.scale}>
        <group position={[-piv.x, -piv.y, -piv.z]} visible={meshVisible}>
          <PartMesh
            part={part}
            palette={partPalettes?.get(part.name) ?? palette}
          />
        </group>
      </group>
      {node.children.map((child) => (
        <RigNodeView
          key={child.part.name}
          node={child}
          palette={palette}
          poses={poses}
          hiddenParts={hiddenParts}
          partPalettes={partPalettes}
        />
      ))}
    </group>
  );
}
