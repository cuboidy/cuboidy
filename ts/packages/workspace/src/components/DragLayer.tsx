import { useEffect, useState } from 'react';
import { Plug } from 'lucide-react';
import type { Thumbnail } from '../lib/thumbnail.js';
import type { DropTarget } from '../lib/drop.js';

interface Props {
  // The model being dragged out of the library, or null when nothing is.
  model: string | null;
  thumb: Thumbnail | undefined;
  // Where it would land, once the pointer is over the 3D view.
  target: DropTarget | null;
}

// What follows the cursor while a model is dragged.
//
// The browser's own drag image is fixed at dragstart and can never be
// changed or hidden afterwards, which is not enough here: over the 3D
// view the scene draws the model's outline where it will land, and a
// second floating copy of the same model is then just clutter. So the
// native image is suppressed (a transparent pixel, set by the card) and
// this takes over — free to become a target caption at the moment the
// pointer crosses into the view.
//
// Position comes from a document-level `dragover` listener. `dragover`
// fires on whatever is under the pointer and bubbles whether or not that
// element accepts the drop, so it tracks everywhere without this layer
// having to make the whole page a drop target.
export function DragLayer({ model, thumb, target }: Props) {
  const [at, setAt] = useState<{ x: number; y: number; overView: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (model === null) {
      setAt(null);
      return undefined;
    }
    const move = (e: DragEvent): void => {
      const el = e.target;
      const overView =
        el instanceof Element && el.closest('.scene-canvas') !== null;
      setAt({ x: e.clientX, y: e.clientY, overView });
    };
    document.addEventListener('dragover', move);
    return () => document.removeEventListener('dragover', move);
  }, [model]);

  if (model === null || at === null) return null;
  // Chromium reports a final 0,0 dragover as the drag ends; drawing the
  // layer in the corner for a frame reads as a glitch.
  if (at.x === 0 && at.y === 0) return null;

  return (
    <div className="drag-layer" style={{ left: at.x, top: at.y }}>
      {at.overView ? (
        <span className="drag-caption">
          {target === null ? (
            'no landing point'
          ) : target.kind === 'socket' ? (
            <>
              <Plug size={11} />
              {target.host} · {target.socket}
            </>
          ) : (
            `${target.pos[0]}, ${target.pos[2]}`
          )}
        </span>
      ) : thumb === undefined ? (
        <span className="drag-caption">{model}</span>
      ) : (
        <img src={thumb.url} width={thumb.px} height={thumb.px} alt="" />
      )}
    </div>
  );
}
