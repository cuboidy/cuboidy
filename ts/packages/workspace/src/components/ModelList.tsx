import { useRef } from 'react';
import { AlertTriangle, Box, Plug } from 'lucide-react';
import type { Library, LibraryModel } from '../lib/library.js';
import type { Thumbnail } from '../lib/thumbnail.js';

interface Props {
  library: Library;
  thumbnails: ReadonlyMap<string, Thumbnail>;
  selected: string | null;
  onSelect: (dir: string) => void;
  // Put a copy in the scene. Reached by dragging a card onto the view, or
  // by double-clicking it — the drag is the gesture, the double-click is
  // there because a drag is hard to discover and impossible on a
  // touchpad-averse day.
  onPlace: (dir: string) => void;
}

// The library: every model the opened folder offers, as cards.
//
// A card rather than a row because the picture IS the identity — `koi`
// and `owl` are two words until you have seen them, and a scene is built
// by choosing shapes. The grid reflows with the panel, so docking it
// narrow gives two columns and widening it gives as many as fit.
//
// What stays on the card is the name, whether it publishes sockets, and
// whether it has problems. Part and clip counts moved to the tooltip:
// what you choose a model BY here is its shape and whether anything can
// be hooked onto it, and the rest is read after choosing, in the panels
// that exist for it.
export function ModelList({
  library,
  thumbnails,
  selected,
  onSelect,
  onPlace,
}: Props) {
  if (library.models.length === 0) {
    return (
      <div className="empty">
        <p>No models in {library.name}.</p>
        <p className="hint">
          A model is a subfolder with a cuboidy.json in it (SPEC §3).
        </p>
      </div>
    );
  }
  return (
    <ul className="model-grid">
      {library.models.map((m) => (
        <ModelCard
          key={m.dir}
          model={m}
          thumb={thumbnails.get(m.dir)}
          selected={m.dir === selected}
          onSelect={() => onSelect(m.dir)}
          onPlace={() => onPlace(m.dir)}
        />
      ))}
    </ul>
  );
}

function ModelCard({
  model,
  thumb,
  selected,
  onSelect,
  onPlace,
}: {
  model: LibraryModel;
  thumb: Thumbnail | undefined;
  selected: boolean;
  onSelect: () => void;
  onPlace: () => void;
}) {
  const img = useRef<HTMLImageElement>(null);
  const published = Object.keys(model.manifest.sockets ?? {}).length;

  return (
    <li>
      <button
        type="button"
        className={`model-card${selected ? ' selected' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-cuboidy-model', model.dir);
          e.dataTransfer.effectAllowed = 'copy';
          // The model itself follows the cursor. The card's own rendered
          // image is reused rather than drawn again: it is already
          // decoded and on screen, which is exactly what setDragImage
          // needs, and a second copy could drift from the first.
          //
          // Fixed at dragstart — the drag image cannot be changed or
          // hidden later. Handing the 3D view its own landing marker is
          // therefore a separate job, not a variation on this one.
          const el = img.current;
          if (el !== null && el.complete) {
            e.dataTransfer.setDragImage(el, el.width / 2, el.height / 2);
          }
        }}
        onClick={onSelect}
        onDoubleClick={onPlace}
        title={`${model.dir} — ${summary(model)}. Drag into the scene, or double-click.`}
      >
        <span className="model-card-art">
          {thumb === undefined ? (
            // Rendering happens a model at a time after the library
            // loads, so the card exists before its picture does. A box
            // outline holds the space rather than letting the grid jump
            // as each image lands.
            <Box size={22} className="model-card-pending" aria-hidden="true" />
          ) : (
            <img
              ref={img}
              src={thumb.url}
              width={thumb.px}
              height={thumb.px}
              alt=""
              draggable={false}
            />
          )}
        </span>
        <span className="model-card-name">{model.dir}</span>
        <span className="model-card-badges">
          {published > 0 && (
            <span
              className="model-card-badge"
              title={`Publishes ${plural(published, 'socket')}`}
            >
              <Plug size={10} />
              {published}
            </span>
          )}
          {model.problems.length > 0 && (
            <AlertTriangle
              size={11}
              className="model-card-warn"
              aria-label={plural(model.problems.length, 'problem')}
            />
          )}
        </span>
      </button>
    </li>
  );
}

function summary(m: LibraryModel): string {
  const bits = [plural(m.parts.size, 'part')];
  if (m.animations.size > 0) bits.push(plural(m.animations.size, 'clip'));
  const published = Object.keys(m.manifest.sockets ?? {}).length;
  if (published > 0) bits.push(plural(published, 'socket'));
  return bits.join(' · ');
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// The published sockets of one model, listed.
export function SocketList({ model }: { model: LibraryModel | null }) {
  if (model === null) return <p className="empty">No model selected.</p>;
  const sockets = Object.entries(model.manifest.sockets ?? {});
  if (sockets.length === 0) {
    return (
      <div className="empty">
        <p>{model.dir} publishes no sockets.</p>
        <p className="hint">
          A model offers attachment points through the manifest&apos;s
          <code> sockets </code> map (SPEC §6.12). Without one, nothing can
          be attached to it.
        </p>
      </div>
    );
  }
  return (
    <ul className="socket-list">
      {sockets.map(([name, target]) => (
        <li key={name} className="socket-row">
          <Plug size={13} className="socket-row-icon" />
          <span className="socket-row-name">{name}</span>
          <span className="socket-row-target">
            {target.part}:{target.socket}
          </span>
        </li>
      ))}
    </ul>
  );
}
