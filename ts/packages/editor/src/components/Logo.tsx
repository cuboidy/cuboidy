/**
 * Cuboidy brand mark. A regular hexagon whose vertices are traced
 * top → upper-left → lower-left → upper-right → lower-right → bottom, so the
 * lower-left→upper-right and bottom→top edges cross at the centre — the
 * point-symmetric two-lobe glyph. Single-colour (the violet accent).
 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Cuboidy"
      className="brand-mark"
    >
      <path
        d="M100 10 L22.06 55 L22.06 145 L177.94 55 L177.94 145 L100 190 Z"
        fill="var(--accent)"
      />
    </svg>
  );
}
