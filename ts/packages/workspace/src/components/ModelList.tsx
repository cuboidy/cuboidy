import { AlertTriangle, Box, Plug } from 'lucide-react';
import type { Library, LibraryModel } from '../lib/library.js';

interface Props {
  library: Library;
  selected: string | null;
  onSelect: (dir: string) => void;
}

// The library: every model the opened folder offers. In later stages a row
// is what you drag into the scene, so it shows what matters when choosing
// one — how many parts, how many clips, and how many attachment points it
// PUBLISHES (SPEC §6.12), since that is what a scene can hook onto.
export function ModelList({ library, selected, onSelect }: Props) {
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
    <ul className="model-list">
      {library.models.map((m) => (
        <li key={m.dir}>
          <button
            type="button"
            className={`model-row${m.dir === selected ? ' selected' : ''}`}
            onClick={() => onSelect(m.dir)}
          >
            <Box size={14} className="model-row-icon" />
            <span className="model-row-name">{m.dir}</span>
            <span className="model-row-meta">{summary(m)}</span>
            {m.problems.length > 0 && (
              <AlertTriangle
                size={13}
                className="model-row-warn"
                aria-label={`${m.problems.length} problem(s)`}
              />
            )}
          </button>
        </li>
      ))}
    </ul>
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

// The published sockets of one model, listed. Stage 1 only shows them;
// stage 1's next chunk makes them drop targets.
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
