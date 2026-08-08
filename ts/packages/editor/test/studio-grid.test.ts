import { describe, expect, it } from 'vitest';
import { studioGridSpec } from '@cuboidy/ui';

// The grid was `<gridHelper args={[n, n]} position={[n/2, 0, n/2]} />`, which
// puts the whole plane in the +X +Z quadrant, with `n` derived from the
// largest single PART's width/depth rather than the model's world bounds.
// Rig positions are signed, so a model reaching into negative X or Z hung
// off the edge — models/submersible spans X -10..9 and Z -15..14 and more of
// it was over nothing than over grid.

describe('studioGridSpec', () => {
  it('covers a model that reaches into negative X and Z', () => {
    // The submersible's actual world bounds.
    const spec = studioGridSpec([-10, 0, -15], [9, 15, 14]);
    // Centred on the origin, so the half-extent is what has to reach.
    expect(spec.size / 2).toBeGreaterThanOrEqual(15);
  });

  it('is symmetric about the origin whichever way the model leans', () => {
    const left = studioGridSpec([-30, 0, -2], [0, 4, 2]);
    const right = studioGridSpec([0, 0, -2], [30, 4, 2]);
    expect(left).toEqual(right);
  });

  it('keeps the line count readable as the model grows', () => {
    for (const reach of [4, 20, 100, 500, 2000]) {
      const spec = studioGridSpec([-reach, 0, -reach], [reach, 0, reach]);
      expect(spec.divisions, `reach ${reach}`).toBeLessThanOrEqual(48);
      expect(spec.divisions, `reach ${reach}`).toBeGreaterThan(4);
    }
  });

  it('steps on values a person would name', () => {
    const nice = new Set([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]);
    for (const reach of [3, 7, 13, 40, 90, 260, 900]) {
      const spec = studioGridSpec([-reach, 0, -reach], [reach, 0, reach]);
      expect(nice.has(spec.step), `reach ${reach} -> step ${spec.step}`).toBe(true);
    }
  });

  it('puts a line ON the origin, not a cell around it', () => {
    for (const reach of [3, 7, 13, 40, 90, 260]) {
      const spec = studioGridSpec([-reach, 0, -reach], [reach, 0, reach]);
      expect(spec.divisions % 2, `reach ${reach}`).toBe(0);
      expect(spec.size, `reach ${reach}`).toBe(spec.divisions * spec.step);
    }
  });

  it('gives a tiny or empty model a plane rather than a speck', () => {
    const spec = studioGridSpec([0, 0, 0], [1, 1, 1]);
    expect(spec.size).toBeGreaterThanOrEqual(12);
  });

  it('leaves margin around the model', () => {
    const spec = studioGridSpec([-10, 0, -10], [10, 0, 10]);
    expect(spec.size / 2).toBeGreaterThan(10);
  });
});
