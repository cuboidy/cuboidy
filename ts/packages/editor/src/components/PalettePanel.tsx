import { AIR, type Color, type Palette, type Part } from '@cuboidy/core';
import { Plus, X } from 'lucide-react';

// What the panel is editing (SPEC §7.4): the palette of ONE geometry file
// — the one defining the selected part. `ref` is set when those colors are
// declared in a shared palette file rather than in the geometry file itself,
// which is the only difference the panel surfaces.
export interface PaletteTarget {
  file: string;
  ref?: string;
}

interface Props {
  // The effective palette being edited.
  palette: Palette;
  // The parts whose voxels resolve against this palette — usage counts
  // (and the parent's delete remap) span every geometry file sharing it.
  parts: readonly Part[];
  target: PaletteTarget;
  // When the relevant source text doesn't parse, the state shown here is
  // stale relative to the user's in-progress edits. Disabling prevents
  // palette mutations from re-serializing and clobbering unsaved text.
  disabled?: boolean;
  disabledReason?: string | undefined;
  // Optional undo-coalescing tag: edits with the same tag in quick
  // succession merge into one history entry. Color edits pass one because
  // <input type="color"> fires onChange continuously while the user drags
  // inside the OS picker.
  onChange: (next: Palette, tag?: string) => void;
  // Deleting a color shifts every higher index in every affected voxel —
  // a cross-file transaction the parent owns.
  onDeleteColor: (index: number) => void;
  // Move this file's colors out to a palette file and point at it
  // (undefined = not available, e.g. already referenced / empty).
  onExternalize?: (() => void) | undefined;
  // Keep the colors but drop the reference, writing them into the geometry
  // file itself (the palette file is kept — it may be shared).
  onInline?: (() => void) | undefined;
}

// Palette editing as a panel. All edits route through the callbacks; the
// parent writes them to where the palette LIVES (a shared palette file, or
// the geometry file itself).
//
// Delete behavior:
//   - Unused color: silent delete.
//   - In-use color: disabled. The "auto-replace cells with AIR" path
//     surprised users — "delete color" should mean "tidy the palette,"
//     not "make voxels disappear."

export const MAX_PALETTE = 62; // SPEC §7.4

export function PalettePanel({
  palette,
  parts,
  target,
  disabled = false,
  disabledReason,
  onChange,
  onDeleteColor,
  onExternalize,
  onInline,
}: Props) {
  const usage = computePaletteUsage(palette, parts);

  const handleEditColor = (index: number, hex: string) => {
    if (disabled) return;
    const rgb = hexToRgb(hex);
    onChange(
      palette.map((c, i) => (i === index ? { ...c, ...rgb } : c)),
      `palette:color:${index}`,
    );
  };

  const handleAddColor = () => {
    if (disabled) return;
    if (palette.length >= MAX_PALETTE) return;
    onChange([...palette, { r: 255, g: 255, b: 255, a: 255 }]);
  };

  return (
    <section className="palette-panel">
      <div className="palette-header">
        <span
          className="palette-target"
          title={
            target.ref !== undefined
              ? `${target.file} uses the shared palette ${target.ref} — editing here writes that file, so every geometry pointing at it changes`
              : `Editing the palette declared inside ${target.file}`
          }
        >
          {target.ref ?? `${target.file} (inline)`}
        </span>
        <span className="palette-count">
          {palette.length} / {MAX_PALETTE}
        </span>
      </div>
      {disabled && (
        <p className="panel-note">
          {disabledReason ??
            'Source has syntax errors — fix to enable palette editing.'}
        </p>
      )}
      <div className={`palette-body${disabled ? ' disabled' : ''}`}>
      <div className="palette-grid">
        {palette.map((color, i) => (
          <PaletteSwatch
            key={i}
            index={i}
            color={color}
            usage={usage[i] ?? 0}
            disabled={disabled}
            onEdit={(hex) => handleEditColor(i, hex)}
            onDelete={() => {
              if (!disabled && (usage[i] ?? 0) === 0) onDeleteColor(i);
            }}
          />
        ))}
        {palette.length < MAX_PALETTE && !disabled && (
          <button
            type="button"
            className="palette-add"
            onClick={handleAddColor}
            title="Add a new color (default white)"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {!disabled && target.ref === undefined && onExternalize !== undefined && (
        <button
          type="button"
          className="btn btn-create btn-sm palette-storage-action"
          title="Move these colors out to a palette file and point this geometry file at it (shareable with other geometry files)"
          onClick={onExternalize}
        >
          Externalize palette
        </button>
      )}
      {!disabled && target.ref !== undefined && onInline !== undefined && (
        <button
          type="button"
          className="btn btn-sm palette-storage-action"
          title={`Write these colors into ${target.file} and drop the reference (${target.ref} is kept)`}
          onClick={onInline}
        >
          Inline palette
        </button>
      )}
      </div>
    </section>
  );
}

interface SwatchProps {
  index: number;
  color: Color;
  usage: number;
  disabled: boolean;
  onEdit: (hex: string) => void;
  onDelete: () => void;
}

// Black or white text for a swatch, chosen by the fill's perceived
// luminance so the index letter / usage count stays legible on any colour.
function contrastText(hex: string | undefined): '#000' | '#fff' {
  const m = hex !== undefined ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  const digits = m?.[1];
  if (digits === undefined) return '#fff';
  const n = parseInt(digits, 16);
  const lum =
    (0.299 * ((n >> 16) & 255) +
      0.587 * ((n >> 8) & 255) +
      0.114 * (n & 255)) /
    255;
  return lum > 0.6 ? '#000' : '#fff';
}

function PaletteSwatch({
  index,
  color,
  usage,
  disabled,
  onEdit,
  onDelete,
}: SwatchProps) {
  const hex = colorToHex(color);
  const label = indexToChar(index);
  const fg = contrastText(hex);
  const inUse = usage > 0;
  // Delete is disabled either by global panel disable (parse error) or
  // because this index is referenced by voxels. Showing two reasons in
  // one tooltip would muddy the message — global disable takes
  // priority since the whole panel is already greyed out as a hint.
  const deleteDisabled = disabled || inUse;
  return (
    <div className="palette-swatch" style={{ backgroundColor: hex }}>
      <input
        type="color"
        className="swatch-picker"
        value={hex}
        disabled={disabled}
        onChange={(e) => onEdit(e.target.value)}
        title={`Index ${index} ('${label}') · ${usage} use${usage === 1 ? '' : 's'}`}
      />
      <span className="swatch-label" style={{ color: fg }}>
        {label}
      </span>
      {inUse && (
        <span className="swatch-usage" style={{ color: fg }}>
          {usage}
        </span>
      )}
      <button
        type="button"
        className="swatch-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={deleteDisabled}
        title={
          inUse
            ? `In use by ${usage} cell(s). Repaint or remove those cells first (or edit the source view directly).`
            : 'Delete this color'
        }
      >
        <X size={13} />
      </button>
    </div>
  );
}

function computePaletteUsage(
  palette: Palette,
  parts: readonly Part[],
): number[] {
  const usage = palette.map(() => 0);
  for (const part of parts) {
    for (const layer of part.voxels) {
      for (const row of layer) {
        for (const idx of row) {
          if (idx !== AIR && idx >= 0 && idx < usage.length) usage[idx]! += 1;
        }
      }
    }
  }
  return usage;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function colorToHex(c: Color): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function indexToChar(idx: number): string {
  if (idx < 10) return String(idx);
  if (idx < 36) return String.fromCharCode(97 + idx - 10);
  return String.fromCharCode(65 + idx - 36);
}
