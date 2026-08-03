import { MAX_PALETTE, indexToChar, parseHexColor, type Color, type Palette, type Part } from '@cuboidy/core';
import { Plus, X } from 'lucide-react';
import { computePaletteUsage } from '../../lib/palette-usage.js';

// What the panel is editing (SPEC §7.4): the palette of ONE geometry file
// — the one defining the selected part. `ref` is set when those colors are
// declared in a shared palette file rather than in the geometry file itself,
// which is the only difference the panel surfaces.
export interface PaletteTarget {
  // The geometry file these colors belong to. ABSENT means the MANIFEST's
  // model-level palette (SPEC §6.13) — what parts written inline draw on.
  file?: string;
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
  // Palette files present in the package (§6.10), package-relative. The
  // picker below binds one to this target — the operation lives here,
  // not on a Files-tree row, because a palette belongs to the document
  // that uses it (§7.4) and this panel is what knows which that is.
  paletteFiles?: readonly string[] | undefined;
  onUsePaletteFile?: ((ref: string) => void) | undefined;
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
  paletteFiles,
  onUsePaletteFile,
}: Props) {
  const usage = computePaletteUsage(palette, parts);
  // The palette files worth offering: every one in the package except
  // the one this target already uses (picking it would be a no-op).
  const bindable = (paletteFiles ?? []).filter((p) => p !== target.ref);
  // The document these colors are written in, for the panel's labels: a
  // geometry file, or the manifest when the target is the model-level
  // palette inline parts draw on (SPEC §6.13).
  const owner = target.file ?? 'cuboidy.json';

  const handleEditColor = (index: number, hex: string) => {
    if (disabled) return;
    // <input type="color"> always yields #rrggbb; the picked color keeps
    // the swatch's existing alpha.
    const picked = parseHexColor(hex);
    if (picked === null) return;
    onChange(
      palette.map((c, i) => (i === index ? { ...picked, a: c.a } : c)),
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
              ? `${owner} uses the shared palette ${target.ref} — editing here writes that file, so every geometry pointing at it changes`
              : `Editing the palette declared inside ${owner}`
          }
        >
          {target.ref ?? `${owner} (inline)`}
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
          title={`Write these colors into ${owner} and drop the reference (${target.ref} is kept)`}
          onClick={onInline}
        >
          Inline palette
        </button>
      )}
      </div>
      {/* OUTSIDE palette-body on purpose: that div goes pointer-events:
          none when the panel is disabled, and an UNRESOLVED reference is
          precisely the state this control exists to fix — pointing
          somewhere that loads is the way out of it. */}
      {onUsePaletteFile !== undefined && bindable.length > 0 && (
        <label className="palette-storage-action palette-use-file">
          <span>Use palette file</span>
          <select
            value=""
            title={`Point ${owner} at a palette file already in this package. Its colors replace the ones shown here — the voxel indices keep their numbers.`}
            onChange={(e) => {
              if (e.target.value !== '') onUsePaletteFile(e.target.value);
            }}
          >
            <option value="">Choose…</option>
            {bindable.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
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

// The <input type="color"> value: #rrggbb, alpha dropped (the input
// cannot represent it — core's serializeColor would emit #RRGGBBAA).
function colorToHex(c: Color): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}
