import { type ReactNode } from 'react';

interface Props {
  title: string;
  // Small right-aligned info in the header (e.g. a count).
  meta?: ReactNode;
  // Panel-local controls in the header (e.g. the Preview panel's
  // cvox/rig/anim toggle in a later phase).
  toolbar?: ReactNode;
  children: ReactNode;
}

// Uniform panel frame for the dockable panel system (design:
// docs/panel-system-design.md, Phase A). Every panel shares this chrome: a
// header (title + meta + panel-local toolbar) and a body.
//
// No collapse: a header sitting over a hidden body reads as a confusing
// dead state. Closing a panel (removing it) + an add-panel picker to bring
// it back land with the dock layout tree in Phase C — they need that state
// to act on.
export function Panel({ title, meta, toolbar, children }: Props) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        {meta !== undefined && <span className="panel-head-meta">{meta}</span>}
        {toolbar !== undefined && (
          <div className="panel-head-tools">{toolbar}</div>
        )}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
