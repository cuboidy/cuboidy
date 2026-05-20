import type { Cvox } from '@cuboidy/core';

interface Props {
  cvox: Cvox;
  hiddenParts: ReadonlySet<string>;
  onToggle: (name: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

// Cbox-view sidebar. Lists parts in declaration order (parser preserves
// source order). Each part has a visibility checkbox — essential because
// the scene stacks all parts at origin [0,0,0] (the .cvox-faithful view),
// so multi-part files would be unreadable without per-part mute. When
// rig view lands, parts will appear at manifest-defined positions and
// this same sidebar can stay (visibility is orthogonal to placement).

export function Sidebar({
  cvox,
  hiddenParts,
  onToggle,
  onShowAll,
  onHideAll,
}: Props) {
  const visibleCount = cvox.parts.length - hiddenParts.size;
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Parts</h2>
        <span className="count">
          {visibleCount} / {cvox.parts.length}
        </span>
      </div>
      <div className="sidebar-actions">
        <button type="button" onClick={onShowAll} disabled={hiddenParts.size === 0}>
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
        {cvox.parts.map((part) => {
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
    </aside>
  );
}
