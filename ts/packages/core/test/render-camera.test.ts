import { describe, expect, it } from 'vitest';
import {
  ANGLES,
  cameraDir,
  makeProjector,
  resolveAngles,
  STANDARD_IDS,
} from '../src/render/camera.js';

describe('cameraDir', () => {
  it('places the front camera on the −Z side (model faces −Z)', () => {
    const d = cameraDir(ANGLES.front!);
    expect(d[0]).toBeCloseTo(0);
    expect(d[1]).toBeCloseTo(0);
    expect(d[2]).toBeCloseTo(-1);
  });

  it('places the right-side camera on the +X side', () => {
    const d = cameraDir(ANGLES.side!);
    expect(d[0]).toBeCloseTo(1);
    expect(d[1]).toBeCloseTo(0);
    expect(d[2]).toBeCloseTo(0);
  });

  it('places the top camera straight above (+Y)', () => {
    const d = cameraDir(ANGLES.top!);
    expect(d[0]).toBeCloseTo(0);
    expect(d[1]).toBeCloseTo(1);
    expect(d[2]).toBeCloseTo(0);
  });
});

describe('makeProjector — front view', () => {
  const proj = makeProjector(ANGLES.front!, [0, 0, 0]);

  it('maps +X to screen-right and +Y to screen-up', () => {
    expect(proj.project([1, 0, 0]).sx).toBeCloseTo(1);
    expect(proj.project([0, 1, 0]).sy).toBeCloseTo(1);
  });

  it('puts farther +Z at greater depth', () => {
    expect(proj.project([0, 0, 1]).depth).toBeGreaterThan(
      proj.project([0, 0, -1]).depth,
    );
  });
});

describe('makeProjector — top view (degenerate up)', () => {
  const proj = makeProjector(ANGLES.top!, [0, 0, 0]);

  it("orients the model's front (−Z) toward screen-up", () => {
    expect(proj.project([0, 0, -1]).sy).toBeGreaterThan(0);
    expect(proj.project([1, 0, 0]).sx).toBeCloseTo(1);
  });
});

describe('resolveAngles', () => {
  it('expands the "standard" group to seven angles', () => {
    const r = resolveAngles('standard');
    expect(Array.isArray(r) && r.map((a) => a.id)).toEqual([...STANDARD_IDS]);
  });

  it('resolves an explicit id list', () => {
    const r = resolveAngles('front,top');
    expect(Array.isArray(r) && r.map((a) => a.id)).toEqual(['front', 'top']);
  });

  it('de-duplicates while preserving order', () => {
    const r = resolveAngles('front,front,side');
    expect(Array.isArray(r) && r.map((a) => a.id)).toEqual(['front', 'side']);
  });

  it('reports unknown angle ids', () => {
    const r = resolveAngles('front,bogus');
    expect(r).toEqual({ error: expect.stringContaining('unknown angle "bogus"') });
  });

  it('rejects an empty selection', () => {
    expect(resolveAngles('')).toEqual({ error: expect.stringContaining('no angles') });
  });
});

// The `unders` group and the custom `az<deg>el<deg>` form shipped without
// tests, and the gap showed: cuboidy-gif advertised the custom form in its
// help while its parser rejected it, and nothing noticed.
describe('resolveAngles — views from below and custom views', () => {
  it('expands `unders` to the four corners at negative elevation', () => {
    const r = resolveAngles('unders');
    expect(Array.isArray(r)).toBe(true);
    if (!Array.isArray(r)) return;
    expect(r.map((a) => a.id)).toEqual(['fr-dn', 'fl-dn', 'br-dn', 'bl-dn']);
    for (const a of r) expect(a.el).toBeLessThan(0);
  });

  it('builds an angle from az<deg>el<deg>', () => {
    const r = resolveAngles('az20el-25');
    expect(Array.isArray(r)).toBe(true);
    if (!Array.isArray(r)) return;
    expect(r).toHaveLength(1);
    expect(r[0]!.az).toBe(20);
    expect(r[0]!.el).toBe(-25);
    // The label must not repeat the numbers — renders stamp AZ/EL already.
    expect(r[0]!.label).toBe('CUSTOM');
  });

  it('accepts a custom angle beside named ones and dedupes by value', () => {
    const r = resolveAngles('front,az20el-25,az20el-25,front');
    expect(Array.isArray(r)).toBe(true);
    if (!Array.isArray(r)) return;
    expect(r.map((a) => a.id)).toEqual(['front', 'az20el-25']);
  });

  it('rejects an elevation past the pole rather than mirroring it', () => {
    for (const spec of ['az0el91', 'az0el-91']) {
      const r = resolveAngles(spec);
      expect(Array.isArray(r)).toBe(false);
      if (!Array.isArray(r)) expect(r.error).toContain(spec);
    }
  });

  it('still rejects something that is not an angle at all', () => {
    const r = resolveAngles('az20');
    expect(Array.isArray(r)).toBe(false);
  });
});
