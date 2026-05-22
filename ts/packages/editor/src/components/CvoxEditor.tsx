import { AIR, type Color, type Cvox, type Part } from '@cuboidy/core';

interface Props {
  cvox: Cvox;
  onChange: (next: Cvox) => void;
}

// First editing surface (A2-rig-4). Lives on the cvox tab and replaces
// the read-only FilePreview that lived there before. For now contains
// only the palette editor; future stages add a per-part voxel painter
// and pivot/socket editors as additional sections within this same
// component — keeping every cvox-affecting edit under one roof.
//
// Edits flow upward via onChange (the parent re-serializes and updates
// source.cvoxFile.text, which Save / Export consume). The parent never
// inspects the edit; this component is the sole producer of cvox
// mutations on the cvox tab.

const MAX_PALETTE = 62; // SPEC §7.4

export function CvoxEditor({ cvox, onChange }: Props) {
  const usage = computePaletteUsage(cvox);

  const handleEditColor = (index: number, hex: string) => {
    const rgb = hexToRgb(hex);
    const newPalette = cvox.palette.map((c, i) =>
      i === index ? { ...c, ...rgb } : c,
    );
    onChange({ ...cvox, palette: newPalette });
  };

  const handleAddColor = () => {
    if (cvox.palette.length >= MAX_PALETTE) return;
    const newPalette: Color[] = [
      ...cvox.palette,
      { r: 255, g: 255, b: 255, a: 255 },
    ];
    onChange({ ...cvox, palette: newPalette });
  };

  // Removes an unused palette entry. Indices above the deleted slot
  // shift down by one, so every voxel referencing a higher index must
  // be remapped. Refuses to delete an in-use color — users must clear
  // those voxels first (voxel painter is A2-rig-6; until then they'd
  // need to hand-edit the source).
  const handleDeleteColor = (index: number) => {
    if ((usage[index] ?? 0) > 0) {
      window.alert(
        `Palette index ${index} is used by ${usage[index]} voxel cell(s). ` +
          `Clear or repaint those cells before deleting the color.`,
      );
      return;
    }
    const newPalette = cvox.palette.filter((_, i) => i !== index);
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
    <div className="cvox-editor">
      <section className="palette-section">
        <div className="section-header">
          <h3>Palette</h3>
          <span className="section-meta">
            {cvox.palette.length} / {MAX_PALETTE}
          </span>
        </div>
        <div className="palette-grid">
          {cvox.palette.map((color, i) => (
            <PaletteSwatch
              key={i}
              index={i}
              color={color}
              usage={usage[i] ?? 0}
              onEdit={(hex) => handleEditColor(i, hex)}
              onDelete={() => handleDeleteColor(i)}
            />
          ))}
          {cvox.palette.length < MAX_PALETTE && (
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
    </div>
  );
}

interface SwatchProps {
  index: number;
  color: Color;
  usage: number;
  onEdit: (hex: string) => void;
  onDelete: () => void;
}

function PaletteSwatch({ index, color, usage, onEdit, onDelete }: SwatchProps) {
  const hex = colorToHex(color);
  const label = indexToChar(index);
  const inUse = usage > 0;
  return (
    <div className="palette-swatch" style={{ backgroundColor: hex }}>
      <input
        type="color"
        className="swatch-picker"
        value={hex}
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
        disabled={inUse}
        title={inUse ? `In use by ${usage} voxel(s)` : 'Delete this color'}
      >
        ×
      </button>
    </div>
  );
}

// Counts non-AIR voxel cells referencing each palette index. Used for
// the in-use badge and to gate deletion.
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
  // `<input type="color">` always returns 7-char lowercase hex (#rrggbb).
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function colorToHex(c: Color): string {
  // Native color picker only handles #RRGGBB. Alpha is preserved in the
  // AST but invisible in the UI for now — when alpha matters, we'll
  // need a custom picker.
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

// SPEC §7.10 voxel-row character mapping: 0–9 → '0'–'9', 10–35 → 'a'–'z',
// 36–61 → 'A'–'Z'. Used here as a label hint so users can correlate
// swatch with the character that would appear in voxel rows.
function indexToChar(idx: number): string {
  if (idx < 10) return String(idx);
  if (idx < 36) return String.fromCharCode(97 + idx - 10);
  return String.fromCharCode(65 + idx - 36);
}
