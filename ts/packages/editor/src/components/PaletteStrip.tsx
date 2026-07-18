import type { Palette } from '@cuboidy/core';

interface Props {
  palette: Palette;
  // Active color index, or -1 when the palette is empty.
  active: number;
  onPick: (index: number) => void;
}

// The paint/attach tools' active-color picker, floating over the
// preview (design decision: painting keeps the eyes on the 3D, so the
// color lives there too — the Palette panel's swatches stay pure color
// EDITORS). Read-only view of the selected part's effective palette.
export function PaletteStrip({ palette, active, onPick }: Props) {
  if (palette.length === 0) {
    return (
      <div className="palette-strip">
        <span className="strip-empty">
          No colors — add one in the Palette panel
        </span>
      </div>
    );
  }
  return (
    <div className="palette-strip" role="listbox" aria-label="Paint color">
      {palette.map((c, i) => (
        <button
          key={i}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`strip-swatch${i === active ? ' active' : ''}`}
          style={{
            backgroundColor: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 255})`,
          }}
          title={`Color ${i}`}
          onClick={() => onPick(i)}
        />
      ))}
    </div>
  );
}
