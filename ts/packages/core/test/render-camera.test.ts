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
