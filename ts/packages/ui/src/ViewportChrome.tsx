import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// The controls that float over a 3D viewport, as shapes rather than as
// one app's specific set.
//
// Generic on purpose: the editor offers three view modes and six tools,
// the workspace two and three, and neither list is the other's subset.
// What they must share is the CONTROL — a segmented pill, a row of icon
// buttons, where each sits over the canvas — so that is what lives here
// and the lists stay with the apps that own them.
//
// Styling comes from @cuboidy/ui/viewport.css. A host that imports these
// components without it gets unstyled controls, which is why the
// stylesheet is a package export rather than something to copy.

// ── overlays ────────────────────────────────────────────────────────

// Top-left of the viewport: what the pointer does.
export function ToolOverlay({ children }: { children: ReactNode }) {
  return <div className="tool-overlay">{children}</div>;
}

// Top-right: what the viewport shows.
export function ViewOverlay({ children }: { children: ReactNode }) {
  return <div className="view-overlay">{children}</div>;
}

// ── segmented view switch ───────────────────────────────────────────

export interface ViewToggleItem<Id extends string> {
  id: Id;
  label: string;
  // Absent = enabled. Present = disabled, and the string is the tooltip
  // saying why — the convention throughout: an unavailable control stays
  // visible and explains itself rather than disappearing.
  unavailable?: string | undefined;
  // Tooltip when enabled.
  title?: string | undefined;
}

export function ViewToggle<Id extends string>({
  value,
  items,
  label,
  onChange,
}: {
  value: Id;
  items: readonly ViewToggleItem<Id>[];
  label: string;
  onChange: (id: Id) => void;
}) {
  return (
    <div className="view-toggle" role="tablist" aria-label={label}>
      {items.map((it) => {
        const disabled = it.unavailable !== undefined;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={value === it.id}
            className={value === it.id ? 'active' : ''}
            disabled={disabled}
            title={it.unavailable ?? it.title ?? it.label}
            onClick={() => {
              if (!disabled) onChange(it.id);
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── exclusive icon tools ────────────────────────────────────────────

export interface ToolBarItem<Id extends string> {
  id: Id;
  icon: LucideIcon;
  label: string;
  unavailable?: string | undefined;
}

// `null` in the list is a divider — the tools either side of it belong to
// different families, and grouping them is part of what the bar says.
export function ToolBar<Id extends string>({
  value,
  items,
  label,
  onChange,
}: {
  value: Id;
  items: readonly (ToolBarItem<Id> | null)[];
  label: string;
  onChange: (id: Id) => void;
}) {
  return (
    <div className="tool-bar" role="toolbar" aria-label={label}>
      {items.map((it, i) =>
        it === null ? (
          // eslint-disable-next-line react/no-array-index-key
          <div key={`divider-${i}`} className="tool-divider" />
        ) : (
          <button
            key={it.id}
            type="button"
            className={value === it.id ? 'active' : ''}
            aria-pressed={value === it.id}
            disabled={it.unavailable !== undefined}
            title={it.unavailable ?? it.label}
            aria-label={it.label}
            onClick={() => onChange(it.id)}
          >
            <it.icon size={14} />
          </button>
        ),
      )}
    </div>
  );
}

// ── independent icon toggles ────────────────────────────────────────

export interface ToggleGroupItem<Id extends string> {
  id: Id;
  icon: LucideIcon;
  label: string;
  on: boolean;
}

export function ToggleGroup<Id extends string>({
  items,
  label,
  onToggle,
}: {
  items: readonly ToggleGroupItem<Id>[];
  label: string;
  onToggle: (id: Id) => void;
}) {
  return (
    <div className="toggle-group" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={it.on ? 'active' : ''}
          aria-pressed={it.on}
          title={it.label}
          aria-label={it.label}
          onClick={() => onToggle(it.id)}
        >
          <it.icon size={14} />
        </button>
      ))}
    </div>
  );
}
