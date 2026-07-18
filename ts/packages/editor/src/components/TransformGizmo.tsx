import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { TransformControls } from '@react-three/drei';
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Line,
  type Object3D,
} from 'three';

interface Props {
  target: Object3D;
  onCommitPosition: (position: [number, number, number]) => void;
}

// The gizmo/picker/helper handle groups of three's
// TransformControlsGizmo — declared private in three-stdlib's types,
// hence this structural view.
interface FlippableGizmo {
  updateMatrixWorld: (force?: boolean) => void;
  gizmo: Record<'translate' | 'rotate' | 'scale', Object3D>;
  picker: Record<'translate' | 'rotate' | 'scale', Object3D>;
  helper: Record<'translate' | 'rotate' | 'scale', Object3D>;
}

// Two stock behaviors of three's translate gizmo are patched out here.
// Both wrap individual handles' updateMatrixWorld so the correction
// lands JUST BEFORE each handle's world matrix is baked, inside the
// gizmo's one normal update pass. Returns the undo.
//
// 1. Axis flip: the arrows always point toward the camera's hemisphere
//    (per-axis 'fwd'/'bwd' cone swap plus a scale negation on the
//    shafts/planes/pickers). The cones point down the NEGATIVE axis
//    half the time — we want fixed +axis arrows — and the flip test,
//    dot(axis, eye) < 0, oscillates per frame while orbiting near the
//    boundary, a visible jitter.
//
// 2. Guide-line precision: the hover/drag axis guide is a unit line
//    BAKED to span roughly −1e3…+1e6 local units, then rescaled every
//    frame by a camera-distance factor. Looking down an axis's
//    negative direction puts that line right past the eye, where
//    float32 quantization of ~1e6-magnitude vertices is amplified by
//    the projection — the line visibly steps while the camera drifts
//    (inertia) instead of tracking smoothly. The geometry is swapped
//    for a symmetric ±500-unit line ("infinite" at our scene scale,
//    precision-safe) and the factor scaling neutralized.
function patchTranslateGizmo(controls: object): () => void {
  const g = (controls as { gizmo: unknown }).gizmo as FlippableGizmo &
    Object3D;
  const restores: (() => void)[] = [];

  // 1 — un-flip arrows/shafts/planes and their pickers.
  for (const grp of [g.gizmo.translate, g.picker.translate]) {
    for (const h of grp.children as (Object3D & { tag?: string })[]) {
      if (h.tag === 'helper') continue;
      const orig = h.updateMatrixWorld;
      h.updateMatrixWorld = (force?: boolean) => {
        if (h.tag === 'bwd') {
          h.visible = false;
        } else {
          h.scale.x = Math.abs(h.scale.x);
          h.scale.y = Math.abs(h.scale.y);
          h.scale.z = Math.abs(h.scale.z);
          // A 'fwd' cone hidden by the flip comes back; one shrunk to
          // ~0 by the axis-hide (axis pointing at the camera) stays
          // hidden.
          if (h.tag === 'fwd' && !h.visible && h.scale.x > 1e-8) {
            h.visible = true;
          }
        }
        orig.call(h, force);
      };
      restores.push(() => {
        h.updateMatrixWorld = orig;
      });
    }
  }

  // 2 — precision-safe guide lines. Per-axis geometry because the
  // stock lines' orientations were baked into their geometries (the
  // objects' own rotations are identity).
  for (const h of g.helper.translate.children as Line[]) {
    if (h.name !== 'X' && h.name !== 'Y' && h.name !== 'Z') continue;
    const axis = { X: 0, Y: 1, Z: 2 }[h.name];
    const pts = [0, 0, 0, 0, 0, 0];
    pts[axis] = -500;
    pts[3 + axis] = 500;
    const guide = new BufferGeometry();
    guide.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const origGeometry = h.geometry;
    h.geometry = guide;
    const orig = h.updateMatrixWorld;
    h.updateMatrixWorld = (force?: boolean) => {
      h.scale.set(1, 1, 1);
      orig.call(h, force);
    };
    restores.push(() => {
      h.updateMatrixWorld = orig;
      h.geometry = origGeometry;
      guide.dispose();
    });
  }

  return () => {
    for (const r of restores) r();
  };
}

// Round to the 0.1 authoring grid (design §2.5): drag math can carry
// float noise, and the file must never see it. The finest legal drag
// step is 0.1 (Shift), so this rounding is lossless for gizmo edits.
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// The move gizmo (docs/preview-editing-design.md §2.4/§3): drei
// TransformControls attached to the selected part's rig group. A drag
// mutates the group's transform imperatively — that IS the live
// preview — and lands as ONE commit on mouse-up (mid-drag dispatches
// would flood the undo history). The group's position is the
// parent-relative manifest position, which is exactly what
// TransformControls edits on a nested object, so the committed value
// needs no space conversion.
//
// Rendered at the Canvas root, not inside the rig recursion: three's
// TransformControls helper doesn't support living under a rotated
// ancestor.
export function TransformGizmo({ target, onCommitPosition }: Props) {
  // Shift = fine snap (design §2.5). Window-level listeners so the
  // state is right even when the canvas doesn't have focus.
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setFine(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setFine(false);
    };
    const blur = () => setFine(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Drag-start position: a click on the gizmo that moves nothing must
  // not commit (the dispatch would push a do-nothing undo entry).
  const startPos = useRef<[number, number, number] | null>(null);

  const controlsRef = useRef<ComponentRef<typeof TransformControls>>(null);
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null) return undefined;
    return patchTranslateGizmo(controls);
  }, []);

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode="translate"
      translationSnap={fine ? 0.1 : 1}
      onMouseDown={() => {
        startPos.current = [
          target.position.x,
          target.position.y,
          target.position.z,
        ];
      }}
      onMouseUp={() => {
        const start = startPos.current;
        startPos.current = null;
        const next: [number, number, number] = [
          round1(target.position.x),
          round1(target.position.y),
          round1(target.position.z),
        ];
        if (
          start !== null &&
          round1(start[0]) === next[0] &&
          round1(start[1]) === next[1] &&
          round1(start[2]) === next[2]
        ) {
          return;
        }
        onCommitPosition(next);
      }}
    />
  );
}
