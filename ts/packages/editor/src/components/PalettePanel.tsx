import { AIR, type Color, type Cvox, type Part } from '@cuboidy/core';

interface Props {
  cvox: Cvox;
  // When the current source text doesn't parse, the AST shown here is
  // stale relative to the user's in-progress edits. Disabling prevents
  // palette mutations from re-serializing and clobbering the user's
  // unsaved text. UX: source must be fixed first.
  disabled?: boolean;
  onChange: (next: Cvox) => void;
}

// Palette editing as a panel — lives in the right sidebar so it's
// visible from any main-pane tab (Preview / cvox / manifest). All
// edits route through onChange; the parent recomposes Cvox into text
// and updates the loaded source.
//
// Delete behavior:
//   - Unused color: silent delete.
//   - In-use color: disabled. The "auto-replace cells with AIR" path
//     surprised users — "delete color" should mean "tidy the palette,"
//     not "make voxels disappear." Users who really want to shrink
//     the palette under in-use indices have two escapes:
//       (a) Hand-edit the source view (the format's source-of-truth).
//       (b) Repaint the cells via the future voxel painter (A2-rig-6),
//           which drops usage to 0 and naturally re-enables delete.
//     The tooltip on the disabled × button names both.

const MAX_PALETTE = 62; // SPEC §7.4

export function PalettePanel({ cvox, disabled = false, onChange }: Props) {
  const usage = computePaletteUsage(cvox);

  const handleEditColor = (index: number, hex: string) => {
    if (disabled) return;
    const rgb = hexToRgb(hex);
    const newPalette = cvox.palette.map((c, i) =>
      i === index ? { ...c, ...rgb } : c,
    );
    onChange({ ...cvox, palette: newPalette });
  };

  const handleAddColor = () => {
    if (disabled) return;
    if (cvox.palette.length >= MAX_PALETTE) return;
    const newPalette: Color[] = [
      ...cvox.palette,
      { r: 255, g: 255, b: 255, a: 255 },
    ];
    onChange({ ...cvox, palette: newPalette });
  };

  // Only valid for an unused index — the button is disabled for in-use
  // colors (see the design note at the top of this file).
  const handleDeleteColor = (index: number) => {
    if (disabled) return;
    if ((usage[index] ?? 0) > 0) return;
    const newPalette = cvox.palette.filter((_, i) => i !== index);
    // Remap voxels: deleted index is unused so no AIR conversion is
    // needed; only the index shift for higher entries applies.
    const newParts: Part[] = cvox.parts.map((p) => ({
      ...p,
      voxels: p.voxels.map((layer) =>
        layer.map((row) =>
          row.map((idx) => (idx === AIR || idx < index ? idx : idx - 1)),
        ),
      ),
    }));
    onChange({ ...cvox, palette: newPalette, parts: newParts });
  };

  return (
    <section className={`palette-panel${disabled ? ' disabled' : ''}`}>
      <div className="panel-header">
        <h3>Palette</h3>
        <span className="panel-meta">
          {cvox.palette.length} / {MAX_PALETTE}
        </span>
      </div>
      {disabled && (
        <p className="panel-note">
          Source has parse errors — fix to enable palette editing.
        </p>
      )}
      <div className="palette-grid">
        {cvox.palette.map((color, i) => (
          <PaletteSwatch
            key={i}
            index={i}
            color={color}
            usage={usage[i] ?? 0}
            disabled={disabled}
            onEdit={(hex) => handleEditColor(i, hex)}
            onDelete={() => handleDeleteColor(i)}
          />
        ))}
        {cvox.palette.length < MAX_PALETTE && !disabled && (
          <button
            type="button"
            className="palette-add"
            onClick={handleAddColor}
            title="Add a new color (default white)"
          >
            +
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
      <span className="swatch-label">{label}</span>
      {inUse && <span className="swatch-usage">{usage}</span>}
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
        ×
      </button>
    </div>
  );
}

function computePaletteUsage(cvox: Cvox): number[] {
  const usage = cvox.palette.map(() => 0);
  for (const part of cvox.parts) {
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
