import { useState } from 'react';
import {
  MATTE,
  MAX_PALETTE,
  indexToChar,
  isMatte,
  parseHexColor,
  type Material,
  type Palette,
  type PaletteEntry,
  type Part,
} from '@cuboidy/core';
import { Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
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
  // `disabled` also covers an UNRESOLVED reference, where the swatches
  // are stale but re-pointing is the fix — so the binding control has
  // its own gate, set only by a mid-edit parse error.
  bindingLocked?: boolean;
  // Optional undo-coalescing tag: edits with the same tag in quick
  // succession merge into one history entry. Color edits pass one because
  // <input type="color"> fires onChange continuously while the user drags
  // inside the OS picker.
  onChange: (next: Palette, tag?: string) => void;
  // Deleting a color shifts every higher index in every affected voxel —
  // a cross-file transaction the parent owns.
  onDeleteColor: (index: number) => void;
  // ── Where the palette LIVES (§7.4). The three moves below are the
  // three values one control can take, not three separate actions:
  // inline in this document, or in one of the package's palette files
  // (an existing one, or a new one written from these colors). ──
  //
  // Palette files present in the package (§6.10), package-relative.
  paletteFiles?: readonly string[] | undefined;
  // Undefined = unavailable: already inline, or a reference that did not
  // load (there would be no colors to keep).
  onInline?: (() => void) | undefined;
  // Undefined = unavailable: already referenced, or no colors to move.
  onExternalize?: (() => void) | undefined;
  onUsePaletteFile?: ((ref: string) => void) | undefined;
}

// Sentinel option values. Paths can be anything, so these are prefixed
// with a character §8 forbids in a reference path.
const INLINE_VALUE = '\0inline';
const NEW_FILE_VALUE = '\0new';

// Palette editing as a panel. All edits route through the callbacks; the
// parent writes them to where the palette LIVES (a shared palette file, or
// the geometry file itself) — and the header's select both SHOWS which of
// those it is and moves it, so the three storage moves (inline it, adopt
// an existing file, write a new one) are the values of one control
// instead of two buttons plus a picker that fired on selection.
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
  bindingLocked = false,
  onChange,
  onDeleteColor,
  onExternalize,
  onInline,
  paletteFiles,
  onUsePaletteFile,
}: Props) {
  const usage = computePaletteUsage(palette, parts);
  // Which swatch's §7.4 material drawer is open. A 56px tile already
  // carries a colour picker, an index, a usage count, a delete and an
  // alpha strip; three more sliders on it would be unusable, so they live
  // in one drawer under the grid and the tile gets a handle.
  const [openMaterial, setOpenMaterial] = useState<number | null>(null);

  // The binding control's current VALUE — where these colors live right
  // now. Selecting another entry moves them there; there is no separate
  // apply step, because changing a select IS the change. (This used to
  // be three controls — two buttons and an action-shaped picker that
  // fired on selection while showing no state.)
  const binding = target.ref ?? INLINE_VALUE;
  const handleBinding = (value: string): void => {
    if (value === binding) return;
    if (value === INLINE_VALUE) onInline?.();
    else if (value === NEW_FILE_VALUE) onExternalize?.();
    else onUsePaletteFile?.(value);
  };
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
      // The picker only knows rgb, so alpha AND the §7.4 material stay as
      // they were — recolouring a slot must not silently unpolish it.
      palette.map((c, i) =>
        i === index
          ? { ...c, color: { ...picked, a: c.color.a } }
          : c,
      ),
      `palette:color:${index}`,
    );
  };

  const handleEditAlpha = (index: number, a: number) => {
    if (disabled) return;
    onChange(
      palette.map((c, i) =>
        i === index ? { ...c, color: { ...c.color, a } } : c,
      ),
      // Its own coalescing key, so a drag along the slider collapses into
      // one undo step and does not merge with a colour change beside it.
      `palette:alpha:${index}`,
    );
  };

  const handleEditMaterial = (index: number, patch: Partial<Material>) => {
    if (disabled) return;
    onChange(
      palette.map((c, i) =>
        i === index
          ? { ...c, material: { ...c.material, ...patch } }
          : c,
      ),
      // One key for the whole material, not one per field: dragging
      // roughness then metallic on the same swatch is one adjustment, and
      // undo should treat it that way.
      `palette:material:${index}`,
    );
  };

  const handleAddColor = () => {
    if (disabled) return;
    if (palette.length >= MAX_PALETTE) return;
    onChange([
      ...palette,
      { color: { r: 255, g: 255, b: 255, a: 255 }, material: MATTE },
    ]);
  };

  // Deleting a swatch renumbers everything above it, so an open drawer can
  // outlive its entry. Treated as closed rather than clamped to a
  // neighbour — silently editing a different colour would be worse.
  const openEntry = openMaterial === null ? undefined : palette[openMaterial];

  return (
    <section className="palette-panel">
      <div className="palette-header">
        <select
          className="palette-binding"
          value={binding}
          aria-label={`Where ${owner}'s palette lives`}
          // Not gated on `disabled`: an unresolved reference greys out
          // the swatches, and picking a target that loads is the way out
          // of that. Only a mid-edit parse error blocks it (bindingLocked).
          disabled={bindingLocked}
          title={
            target.ref !== undefined
              ? `${owner} uses the shared palette ${target.ref} — editing colors here writes that file, so every document pointing at it changes`
              : `The palette is declared inside ${owner}. Pick a file to share these colors instead.`
          }
          onChange={(e) => handleBinding(e.target.value)}
        >
          <option value={INLINE_VALUE}>{owner} (inline)</option>
          {(paletteFiles ?? []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {/* A reference to a file that is not in the package: keep it
              selectable so the control shows the truth rather than
              silently snapping to another entry. */}
          {target.ref !== undefined &&
            !(paletteFiles ?? []).includes(target.ref) && (
              <option value={target.ref}>{target.ref} (missing)</option>
            )}
          {onExternalize !== undefined && (
            <option value={NEW_FILE_VALUE}>New palette file…</option>
          )}
        </select>
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
            materialOpen={openMaterial === i}
            onEdit={(hex) => handleEditColor(i, hex)}
            onEditAlpha={(a) => handleEditAlpha(i, a)}
            onToggleMaterial={() =>
              setOpenMaterial((prev) => (prev === i ? null : i))
            }
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
      {openMaterial !== null && openEntry !== undefined && (
        <MaterialDrawer
          index={openMaterial}
          entry={openEntry}
          disabled={disabled}
          onChange={(patch) => handleEditMaterial(openMaterial, patch)}
          onClose={() => setOpenMaterial(null)}
        />
      )}
      </div>
    </section>
  );
}

const MATERIAL_FIELDS: ReadonlyArray<{
  key: keyof Material;
  label: string;
  hint: string;
}> = [
  { key: 'metallic', label: 'Metallic', hint: '0 = dielectric, 1 = metal' },
  { key: 'roughness', label: 'Roughness', hint: '0 = mirror, 1 = fully diffuse' },
  { key: 'emissive', label: 'Emissive', hint: 'scales this colour as self-illumination' },
];

interface DrawerProps {
  index: number;
  entry: PaletteEntry;
  disabled: boolean;
  onChange: (patch: Partial<Material>) => void;
  onClose: () => void;
}

// SPEC §7.4's three material fields for one entry. Steps of 0.01 because
// the file format takes any number in 0..1 and a coarser slider would make
// values it can express unreachable from the UI.
function MaterialDrawer({
  index,
  entry,
  disabled,
  onChange,
  onClose,
}: DrawerProps) {
  return (
    <div className="palette-material">
      <div className="palette-material-head">
        <span className="palette-material-title">
          Material · index {index} (&lsquo;{indexToChar(index)}&rsquo;)
        </span>
        <button
          type="button"
          className="palette-material-reset"
          disabled={disabled || isMatte(entry.material)}
          onClick={() => onChange(MATTE)}
          title="Back to a plain matte surface — the §7.4 default, written as a bare colour"
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          className="palette-material-close"
          onClick={onClose}
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
      {MATERIAL_FIELDS.map(({ key, label, hint }) => (
        <label className="palette-material-row" key={key}>
          <span className="palette-material-label">{label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={entry.material[key]}
            disabled={disabled}
            onChange={(e) => onChange({ [key]: Number(e.target.value) })}
            title={hint}
            aria-label={`${label} of palette index ${index}`}
          />
          <span className="palette-material-value">
            {entry.material[key].toFixed(2)}
          </span>
        </label>
      ))}
    </div>
  );
}

interface SwatchProps {
  index: number;
  color: PaletteEntry;
  usage: number;
  disabled: boolean;
  materialOpen: boolean;
  onEdit: (hex: string) => void;
  onEditAlpha: (a: number) => void;
  onToggleMaterial: () => void;
  onDelete: () => void;
}

// The tooltip on the material handle, and the only place in the grid where
// a finish is legible. Two entries can hold the SAME hex and differ only in
// roughness — models-test/materials does exactly that — so a swatch showing
// colour alone is ambiguous by construction.
function materialSummary(e: PaletteEntry): string {
  const m = e.material;
  if (isMatte(m)) return 'Matte — set metallic / roughness / emissive';
  const parts: string[] = [];
  if (m.metallic !== MATTE.metallic) parts.push(`metallic ${m.metallic}`);
  if (m.roughness !== MATTE.roughness) parts.push(`roughness ${m.roughness}`);
  if (m.emissive !== MATTE.emissive) parts.push(`emissive ${m.emissive}`);
  return parts.join(' · ');
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
  materialOpen,
  onEdit,
  onEditAlpha,
  onToggleMaterial,
  onDelete,
}: SwatchProps) {
  const hex = colorToHex(color);
  const label = indexToChar(index);
  const fg = contrastText(hex);
  const pct = Math.round((color.color.a / 255) * 100);
  const inUse = usage > 0;
  // Delete is disabled either by global panel disable (parse error) or
  // because this index is referenced by voxels. Showing two reasons in
  // one tooltip would muddy the message — global disable takes
  // priority since the whole panel is already greyed out as a hint.
  const deleteDisabled = disabled || inUse;
  return (
    // The tile itself carries the alpha checkerboard; the fill sits over it
    // at the colour's own opacity, so a translucent entry looks translucent
    // here as well as in the viewport (SPEC §7.4).
    <div className="palette-swatch">
      <span
        className="swatch-fill"
        style={{
          backgroundColor: `rgba(${color.color.r}, ${color.color.g}, ${color.color.b}, ${color.color.a / 255})`,
        }}
      />
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
      {/* §7.4 material handle. Always visible once the entry is not matte,
          because a finish is otherwise invisible in the grid — and hover-only
          on a matte one, so a palette that uses no materials looks exactly
          as it did. Above the picker in z-order, like the alpha strip. */}
      <button
        type="button"
        className={`swatch-material${isMatte(color.material) ? '' : ' set'}${materialOpen ? ' open' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMaterial();
        }}
        title={materialSummary(color)}
        aria-label={`Material of index ${index}`}
        aria-expanded={materialOpen}
      >
        <SlidersHorizontal size={11} />
      </button>
      {/* `<input type="color">` has no alpha channel — the platform picker
          cannot express one — so opacity is its own control. Full width at
          the tile's foot, above the picker in z-order so it takes the drag
          rather than opening the colour dialog. */}
      <input
        type="range"
        className="swatch-alpha"
        min={0}
        max={255}
        step={1}
        value={color.color.a}
        disabled={disabled}
        onChange={(e) => onEditAlpha(Number(e.target.value))}
        title={`Opacity ${pct}% (alpha ${color.color.a}/255)`}
        aria-label={`Opacity of index ${index}`}
      />
    </div>
  );
}

// The <input type="color"> value: #rrggbb, alpha dropped (the input
// cannot represent it — core's serializeColor would emit #RRGGBBAA).
function colorToHex(c: PaletteEntry): string {
  return `#${hex2(c.color.r)}${hex2(c.color.g)}${hex2(c.color.b)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}
