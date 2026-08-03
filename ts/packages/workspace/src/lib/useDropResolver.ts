import { useCallback, useMemo, useRef, useState } from 'react';
import { Vector3, type Camera } from 'three';
import {
  dropKey,
  resolveDrop,
  socketCandidates,
  type DropTarget,
} from './drop.js';
import type { LibraryModel } from './library.js';
import type { PlacedInstance } from './scene-resolve.js';

// Pointer → where the dragged model would land. `resolveAt` runs on
// every dragover, but the view only re-renders when the ANSWER changes:
// the ground point is snapped to whole units, so moving within one cell
// is not an event.
export function useDropResolver({
  placed,
  dragModel,
  onDropTarget,
}: {
  placed: readonly PlacedInstance[];
  dragModel: LibraryModel | null;
  // Mirrors the target out (the DragLayer follows the cursor with it).
  onDropTarget: (target: DropTarget | null) => void;
}): {
  // The camera, captured from inside the Canvas (CaptureCamera) so the
  // DOM-side drag handlers can project with it. A ref rather than
  // state: it is read during an event, never rendered from.
  cameraRef: { current: Camera | null };
  target: DropTarget | null;
  resolveAt: (clientX: number, clientY: number, rect: DOMRect) => void;
  clearTarget: () => void;
} {
  const cameraRef = useRef<Camera | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetKey = useRef('');

  // Every published socket in the scene, in world space. Recomputed when
  // the arrangement changes, not per pointer move.
  const candidates = useMemo(
    () => (dragModel === null ? [] : socketCandidates(placed)),
    [dragModel, placed],
  );

  const setTargetIfChanged = useCallback(
    (next: DropTarget | null) => {
      const key = dropKey(next);
      if (key === targetKey.current) return;
      targetKey.current = key;
      setTarget(next);
      onDropTarget(next);
    },
    [onDropTarget],
  );

  const resolveAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const camera = cameraRef.current;
      if (camera === null) {
        setTargetIfChanged(null);
        return;
      }
      const px: [number, number] = [clientX - rect.left, clientY - rect.top];
      const ndc = new Vector3(
        (px[0] / rect.width) * 2 - 1,
        -(px[1] / rect.height) * 2 + 1,
        0.5,
      ).unproject(camera);
      const origin = camera.position;
      const dir = ndc.sub(origin).normalize();
      setTargetIfChanged(
        resolveDrop(
          {
            origin: [origin.x, origin.y, origin.z],
            dir: [dir.x, dir.y, dir.z],
          },
          px,
          candidates,
          (p) => {
            const v = new Vector3(p[0], p[1], p[2]).project(camera);
            // Behind the camera: `project` still returns a point, mirrored
            // through the origin, which would make a socket at your back
            // the nearest thing on screen.
            if (v.z > 1) return null;
            return [
              ((v.x + 1) / 2) * rect.width,
              ((-v.y + 1) / 2) * rect.height,
            ];
          },
        ),
      );
    },
    [candidates, setTargetIfChanged],
  );

  const clearTarget = useCallback(
    () => setTargetIfChanged(null),
    [setTargetIfChanged],
  );

  return { cameraRef, target, resolveAt, clearTarget };
}
