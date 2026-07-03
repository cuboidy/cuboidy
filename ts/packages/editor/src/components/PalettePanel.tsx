import { AIR, type Color, type Palette, type Part } from '@cuboidy/core';

// What the panel is editing — the model's EFFECTIVE palette per the
// SPEC §6.10 precedence: the manifest-bound external file when a
// binding exists, else the primary geometry file's inline declaration.
export type PaletteTarget =
  | { kind: 'external'; path: string }
  | { kind: 'inline'; file: string };

interface Props {
  // The effective palette being edited.
  palette: Palette;
  // Every part of the model — usage counts (and the parent's delete
  // remap) span all geometry files sharing this palette.
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
  // Move the inline palette out to palette.json and bind it (undefined =
  // not available, e.g. no manifest / already external).
  onExternalize?: (() => void) | undefined;
  // Copy the bound palette back into the primary file's inline
  // declaration and drop the binding (the file is kept).
  onInline?: (() => void) | undefined;
}

// Palette editing as a panel. All edits route through the callbacks;
// the parent writes them to where the palette LIVES (palette.json or
// the primary .cvox).
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
    <section className={`palette-panel${disabled ? ' disabled' : ''}`}>
      <div className="palette-header">
        <span
          className="palette-target"
          title={
            target.kind === 'external'
              ? `Editing the manifest-bound palette (${target.path}) — applies to every geometry file`
              : `Editing the inline palette declared in ${target.file}`
          }
        >
          {target.kind === 'external' ? target.path : `${target.file} (inline)`}
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
            +
          </button>
        )}
      </div>
      {!disabled && target.kind === 'inline' && onExternalize !== undefined && (
        <button
          type="button"
          className="btn btn-create btn-sm palette-storage-action"
          title="Move this palette out to palette.json and bind it in the manifest (shareable across files and skins)"
          onClick={onExternalize}
        >
          Externalize palette
        </button>
      )}
      {!disabled && target.kind === 'external' && onInline !== undefined && (
        <button
          type="button"
          className="btn btn-sm palette-storage-action"
          title={`Copy the bound palette into the primary geometry file and drop the binding (${target.path} is kept)`}
          onClick={onInline}
        >
          Inline palette
        </button>
      )}
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
