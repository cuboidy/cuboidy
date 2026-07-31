import type { ReactNode } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';

// One row in the Console panel. `source` is the file the entry is about
// (shown as a muted mono tag); `message` allows inline markup (<code> etc.).
export interface ConsoleEntry {
  severity: 'error' | 'warning';
  source?: string;
  message: ReactNode;
}

// The Console dock panel: the model's current problems (live syntax errors)
// and load-time notices (e.g. dropped inline comments) as a list. Purely
// derived from existing app state — App assembles the entries; this just
// renders them. Empty state says so rather than rendering a blank body.
export function ConsolePanel({ entries }: { entries: ConsoleEntry[] }) {
  if (entries.length === 0) {
    return <p className="panel-empty">No problems detected.</p>;
  }
  return (
    <ul className="console-list">
      {entries.map((e, i) => (
        <li key={i} className={`console-entry ${e.severity}`}>
          <span className="console-severity" aria-hidden="true">
            {e.severity === 'error' ? (
              <XCircle size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
          </span>
          <span className="console-message">
            {e.source !== undefined && (
              <span className="console-source">{e.source}</span>
            )}
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
