import { useCallback, useMemo } from 'react';
import { quatFromEulerZXYDeg, type Palette } from '@cuboidy/core';
import { RiggedParts } from '@cuboidy/r3f';
import { buildRigTreeOf } from '@cuboidy/three';
import type { Object3D } from 'three';
import type { SceneNode } from '../../lib/scene-tree.js';
import type { SceneGizmos } from '../../lib/view.js';
import { InstanceGizmos } from '../InstanceGizmos.js';

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
export function InstanceMesh({
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
    const parts = [...placed.model.parts.values()];
    if (parts.length === 0) return null;
    const partPalettes = new Map<string, Palette>();
    for (const [name, r] of placed.model.parts) partPalettes.set(name, r.palette);
    return {
      // Fallback only — RiggedParts reaches for this when a part is
      // absent from partPalettes, which never happens here (the loop
      // above covers every part in placed.model.parts). Kept because the
      // prop is required; first part's palette is as good a guess as any.
      palette: parts[0]?.palette ?? [],
      partPalettes,
      roots: buildRigTreeOf(
        parts.map((r) => r.part),
        placed.model.manifest,
      ),
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
              palette={view.palette}
              partPalettes={view.partPalettes}
              poses={placed.poses}
              hiddenParts={EMPTY}
              selectedPart={null}
              // gizmos omitted: a scene selects models, not their parts,
              // and the model-level overlays below are InstanceGizmos' job.
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

const EMPTY: ReadonlySet<string> = new Set();
