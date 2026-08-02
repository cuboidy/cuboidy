import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { TransformControls } from '@react-three/drei';
import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Quaternion,
  type Line,
  type Object3D,
  type Vector3,
} from 'three';
import type { QuatTuple } from '@cuboidy/core';

interface Props {
  target: Object3D;
  mode: 'translate' | 'rotate';
  // Default translation snap step: 1.0 for part bodies,
  // 0.5 for pivot / socket markers. Shift always drops to 0.1.
  snapCoarse: number;
  // Rotations to factor OUT of the target's quaternion before the
  // euler conversion on a rotate commit — the rig group carries the
  // §7.7 composite q_rotation ⊗ q_pivot, and only one factor belongs
  // to the value being edited. Part-body rotate: factorOutRight =
  // pivot.rot (keeps q_rotation). Pivot rotate: factorOutLeft = the
  // manifest rest rotation (keeps q_pivot). Sockets: neither (their
  // quaternion is stored as-is).
  //
  // QUATERNIONS, not the euler degrees the callers mostly hold: a
  // workspace instance's factor is a composed attachment frame that was
  // never euler in the first place, and euler → quat → euler is
  // ill-conditioned near gimbal lock. Callers holding degrees convert
  // with quatFromEulerZXYDeg, which is exact in that direction.
  factorOutLeft: QuatTuple | undefined;
  factorOutRight: QuatTuple | undefined;
  onCommitPosition: (position: [number, number, number]) => void;
  // Euler degrees, ZXY intrinsic (§4). [0,0,0] = identity; the App
  // drops the field for it (inspector convention).
  onCommitRotation: (rotation: [number, number, number]) => void;
}

// The gizmo/picker/helper handle groups (plus the camera-tracking
// fields the constant-screen-size scaling reads) of three's
// TransformControlsGizmo — declared private in three-stdlib's types,
// hence this structural view.
interface FlippableGizmo {
  updateMatrixWorld: (force?: boolean) => void;
  gizmo: Record<'translate' | 'rotate' | 'scale', Object3D>;
  picker: Record<'translate' | 'rotate' | 'scale', Object3D>;
  helper: Record<'translate' | 'rotate' | 'scale', Object3D>;
  camera: { fov: number; zoom: number };
  size: number;
  axis: string | null;
  worldPosition: Vector3;
  cameraPosition: Vector3;
}

// Two stock behaviors of three's transform gizmo are patched out here.
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
//
// 3. View-dependent hiding: an axis pointing (nearly) at the camera
//    gets its arrow/shaft/picker shrunk away, edge-on planes likewise,
//    the rotate rings are HALF circles re-oriented every frame to face
//    the camera, and the rotate mode's axis guide hides when its axis
//    nears the view direction — all of it reads as "parts of the gizmo
//    randomly missing" while orbiting. Every hide is unwound (the
//    shrinks by recomputing the factor scale they destroyed) and the
//    rings are swapped for full circles.
//
// 4. The plane handles' corner L-brackets are decorative clutter —
//    dropped (the quad alone reads fine).
//
// 5. The center XYZ free-move handle is dropped: arrows + planes are
//    the predictable moves (design feedback — free screen-plane
//    dragging reads as "the marker itself is being dragged"), and it
//    sat exactly on top of the pivot/socket markers, fighting their
//    click-to-toggle. Pickers raycast even while invisible, so the
//    picker is dead-ended rather than hidden.
function patchGizmo(controls: object): () => void {
  const g = (controls as { gizmo: unknown }).gizmo as FlippableGizmo &
    Object3D;
  const restores: (() => void)[] = [];

  // The per-handle scale the gizmo applies for constant screen size —
  // recomputed because the axis-hide overwrote it with ~0 before our
  // wrapper runs. Mirrors the perspective branch of the stock code.
  const gizmoScaleFactor = (): number => {
    const dist = g.worldPosition.distanceTo(g.cameraPosition);
    const factor =
      dist *
      Math.min((1.9 * Math.tan((Math.PI * g.camera.fov) / 360)) / g.camera.zoom, 7);
    return (factor * g.size) / 7;
  };

  // 1 + 3a + 4 — un-flip arrows/shafts/planes and their pickers, keep
  // every handle visible regardless of view angle, drop the plane
  // corner brackets.
  for (const grp of [g.gizmo.translate, g.picker.translate]) {
    for (const h of grp.children as (Object3D & {
      tag?: string;
      isLine?: boolean;
    })[]) {
      if (h.tag === 'helper') continue;
      if (h.name === 'XYZ') {
        // 5 — drop the center free-move handle.
        if (grp === g.picker.translate) {
          const origRaycast = h.raycast;
          h.raycast = () => {};
          restores.push(() => {
            h.raycast = origRaycast;
          });
        } else {
          const orig = h.updateMatrixWorld;
          h.updateMatrixWorld = (force?: boolean) => {
            h.visible = false;
            orig.call(h, force);
          };
          restores.push(() => {
            h.updateMatrixWorld = orig;
          });
        }
        continue;
      }
      const planeBracket =
        h.isLine === true &&
        (h.name === 'XY' || h.name === 'YZ' || h.name === 'XZ');
      const orig = h.updateMatrixWorld;
      h.updateMatrixWorld = (force?: boolean) => {
        if (planeBracket || h.tag === 'bwd') {
          h.visible = false;
        } else {
          // Un-hide the view-dependent shrink (3): head-on axes and
          // edge-on planes come back with the factor scale restored.
          if (Math.abs(h.scale.x) < 1e-9) {
            h.scale.setScalar(gizmoScaleFactor());
            h.visible = true;
          }
          h.scale.x = Math.abs(h.scale.x);
          h.scale.y = Math.abs(h.scale.y);
          h.scale.z = Math.abs(h.scale.z);
          // A 'fwd' cone hidden by the flip comes back.
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

  // 3b — full-circle rotate rings. The stock rings are half circles
  // (their pickers are already full tori); orientation was baked into
  // each ring's geometry, so the replacements bake the same rotation.
  // The stock per-frame "face the camera" re-orientation still runs,
  // but a full circle is invariant under rotation about its own axis
  // (it only slides the grab nub around, which is fine).
  for (const h of g.gizmo.rotate.children as (Line & { isLine?: boolean })[]) {
    if (h.isLine !== true) continue;
    const bake = ({ X: null, Y: 'z', Z: 'y' } as const)[
      h.name as 'X' | 'Y' | 'Z'
    ];
    if (bake === undefined) continue;
    const pts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      pts.push(0, Math.cos((i / 32) * Math.PI), Math.sin((i / 32) * Math.PI));
    }
    const ring = new BufferGeometry();
    ring.setAttribute('position', new Float32BufferAttribute(pts, 3));
    if (bake === 'z') ring.rotateZ(-Math.PI / 2);
    if (bake === 'y') ring.rotateY(Math.PI / 2);
    const origGeometry = h.geometry;
    h.geometry = ring;
    restores.push(() => {
      h.geometry = origGeometry;
      ring.dispose();
    });
  }

  // 2 — precision-safe guide lines. Per-axis geometry because the
  // stock lines' orientations were baked into their geometries (the
  // objects' own rotations are identity).
  const patchGuide = (h: Line, axis: 0 | 1 | 2) => {
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
  };
  for (const h of g.helper.translate.children as Line[]) {
    const axis = ({ X: 0, Y: 1, Z: 2 } as const)[h.name as 'X' | 'Y' | 'Z'];
    if (axis !== undefined) patchGuide(h, axis);
  }
  // The rotate mode's active-axis guide is one X-baked line the gizmo
  // re-orients at runtime — same 1e6 bake, same fix. It additionally
  // hides when its axis nears the view direction (|dot| > 0.9); undone
  // here (3): whenever a single-axis ring is active, the guide stays
  // up (its orientation was already computed before the stock hide).
  for (const h of g.helper.rotate.children as Line[]) {
    if (h.name !== 'AXIS') continue;
    patchGuide(h, 0);
    const orig = h.updateMatrixWorld;
    h.updateMatrixWorld = (force?: boolean) => {
      const a = g.axis;
      if (a === 'X' || a === 'Y' || a === 'Z') h.visible = true;
      // Stock anchors the guide at worldPositionStart — recorded only
      // when a drag STARTS, so on a first hover the line sits at the
      // world origin. Rotating never moves the target, so the current
      // world position is always the right anchor.
      h.position.copy(g.worldPosition);
      orig.call(h, force);
    };
    restores.push(() => {
      h.updateMatrixWorld = orig;
    });
  }

  return () => {
    for (const r of restores) r();
  };
}

// Round to the 0.1 authoring grid: drag math can carry
// float noise, and the file must never see it. The finest legal drag
// step is 0.1 units / 1° (Shift), so 0.1 rounding is lossless for
// positions and comfortably fine for the euler angles a rotate drag
// composes.
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// The move/rotate gizmo: drei
// TransformControls attached to the selected part's rig group. A drag
// mutates the group's transform imperatively — that IS the live
// preview — and lands as ONE commit on mouse-up (mid-drag dispatches
// would flood the undo history). The group's position is the
// parent-relative manifest position, which is exactly what
// TransformControls edits on a nested object, so the move commit needs
// no space conversion; the rotate commit factors q_pivot out of the
// group quaternion and converts back to the SPEC's ZXY euler degrees
// (three's 'ZXY' Euler order matches quatFromEulerZXYDeg exactly —
// pinned by core's rig-transform tests).
//
// Rendered at the Canvas root, not inside the rig recursion: three's
// TransformControls helper doesn't support living under a rotated
// ancestor.
export function TransformGizmo({
  target,
  mode,
  snapCoarse,
  factorOutLeft,
  factorOutRight,
  onCommitPosition,
  onCommitRotation,
}: Props) {
  // Shift = fine snap. Window-level listeners so the
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
  const startQuat = useRef<Quaternion | null>(null);

  const controlsRef = useRef<ComponentRef<typeof TransformControls>>(null);
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null) return undefined;
    return patchGizmo(controls);
  }, []);

  // Composed target quaternion → the edited factor in ZXY euler
  // degrees, rounded to the 0.1° grid:
  //   q_edited = q_left⁻¹ ⊗ q ⊗ q_right⁻¹    (§7.7 factoring)
  const extractRestEuler = (q: Quaternion): [number, number, number] => {
    const rest = q.clone();
    if (factorOutRight !== undefined) {
      const [px, py, pz, pw] = factorOutRight;
      rest.multiply(new Quaternion(px, py, pz, pw).invert());
    }
    if (factorOutLeft !== undefined) {
      const [px, py, pz, pw] = factorOutLeft;
      rest.premultiply(new Quaternion(px, py, pz, pw).invert());
    }
    const e = new Euler().setFromQuaternion(rest, 'ZXY');
    const D = 180 / Math.PI;
    return [round1(e.x * D), round1(e.y * D), round1(e.z * D)];
  };

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode={mode}
      translationSnap={fine ? 0.1 : snapCoarse}
      rotationSnap={((fine ? 1 : 15) * Math.PI) / 180}
      onMouseDown={() => {
        startPos.current = [
          target.position.x,
          target.position.y,
          target.position.z,
        ];
        startQuat.current = target.quaternion.clone();
      }}
      onMouseUp={() => {
        const sPos = startPos.current;
        const sQuat = startQuat.current;
        startPos.current = null;
        startQuat.current = null;
        if (mode === 'translate') {
          const next: [number, number, number] = [
            round1(target.position.x),
            round1(target.position.y),
            round1(target.position.z),
          ];
          if (
            sPos !== null &&
            round1(sPos[0]) === next[0] &&
            round1(sPos[1]) === next[1] &&
            round1(sPos[2]) === next[2]
          ) {
            return;
          }
          onCommitPosition(next);
        } else {
          const next = extractRestEuler(target.quaternion);
          if (sQuat !== null) {
            const prev = extractRestEuler(sQuat);
            if (
              prev[0] === next[0] &&
              prev[1] === next[1] &&
              prev[2] === next[2]
            ) {
              return;
            }
          }
          onCommitRotation(next);
        }
      }}
    />
  );
}
