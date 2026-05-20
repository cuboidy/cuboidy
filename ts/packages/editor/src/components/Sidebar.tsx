import type { LoadedSource } from '../lib/types.js';
import { FileTree } from './FileTree.js';

interface Props {
  source: LoadedSource;
  hiddenParts: ReadonlySet<string>;
  onToggle: (name: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onCreateManifest: () => void;
}

// Two-section sidebar: Files (read-only file tree, the project's
// "Explorer" pane) + Parts (visibility toggles for the loaded cvox).
// Files is the navigation surface that grows when per-file editor
// switching lands in A2-rig-3+. Parts is the cvox-specific tool that
// stays useful in both view modes (visibility is orthogonal to layout).

export function Sidebar({
  source,
  hiddenParts,
  onToggle,
  onShowAll,
  onHideAll,
  onCreateManifest,
}: Props) {
  const visibleCount = source.cvox.parts.length - hiddenParts.size;
  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <div className="sidebar-section-header">
          <h2>Files</h2>
        </div>
        <FileTree source={source} onCreateManifest={onCreateManifest} />
      </section>

      <section className="sidebar-section">
        <div className="sidebar-section-header">
          <h2>Parts</h2>
          <span className="count">
            {visibleCount} / {source.cvox.parts.length}
          </span>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            onClick={onShowAll}
            disabled={hiddenParts.size === 0}
          >
            Show all
          </button>
          <button
            type="button"
            onClick={onHideAll}
            disabled={visibleCount === 0}
          >
            Hide all
          </button>
        </div>
        <ul className="part-list">
          {source.cvox.parts.map((part) => {
            const hidden = hiddenParts.has(part.name);
            return (
              <li
                key={part.name}
                className={`part-item${hidden ? ' hidden' : ''}`}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={() => onToggle(part.name)}
                  />
                  <span className="part-name">{part.name}</span>
                  <span className="part-size">
                    {part.size.w}×{part.size.h}×{part.size.d}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
