import { useEffect, useReducer, type RefObject } from 'react';
import type { Object3D } from 'three';
import type { QuatTuple } from '@cuboidy/core';
import { TransformGizmo } from './TransformGizmo.js';

// Resolves the gizmo's target Object3D from a registry INSIDE the canvas.
//
// <Canvas> children commit in r3f's own React root, so only an effect in
// here is guaranteed to run AFTER the registering callback refs of the
// same pass. (A DOM-side effect in the owning component runs before the
// r3f subtree commits — it would read a still-empty registry whenever the
// scene remounts, e.g. returning from another view with a transform tool
// active, and the gizmo would simply never appear.) When the first render
// of a pass misses, the effect bumps and the second render resolves.
//
// Shared rather than reimplemented per app because the bug it fixes is
// invisible until the exact remount that triggers it, and it is not the
// kind of thing a second implementation gets right by accident.
export function TransformGizmoHost({
  registry,
  objectKey,
  mode,
  snapCoarse,
  factorOutLeft,
  factorOutRight,
  onCommitPosition,
  onCommitRotation,
}: {
  registry: RefObject<Map<string, Object3D>>;
  objectKey: string;
  mode: 'translate' | 'rotate';
  snapCoarse: number;
  factorOutLeft: QuatTuple | undefined;
  factorOutRight: QuatTuple | undefined;
  onCommitPosition: (position: [number, number, number]) => void;
  onCommitRotation: (rotation: [number, number, number]) => void;
}) {
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const target = registry.current.get(objectKey) ?? null;
  useEffect(() => {
    if (target === null && registry.current.has(objectKey)) bump();
  });
  if (target === null) return null;
  return (
    <TransformGizmo
      target={target}
      mode={mode}
      snapCoarse={snapCoarse}
      factorOutLeft={factorOutLeft}
      factorOutRight={factorOutRight}
      onCommitPosition={onCommitPosition}
      onCommitRotation={onCommitRotation}
    />
  );
}
