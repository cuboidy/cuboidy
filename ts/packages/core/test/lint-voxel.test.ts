import { describe, expect, it } from 'vitest';
import { lintGeometry } from '../src/lint/voxel-rules.js';
import type { Geometry } from '../src/geometry/types.js';
import { readFixtureText } from './helpers/fixtures.js';
import { parseGeometryText } from '../src/geometry/parse.js';
import { geo, type PartSpec } from './helpers/geometry.js';

// Builds the AST these rules run on by going through the real reader, so a
// case can never assert against a shape the reader would not produce.
function model(parts: PartSpec[], palette?: string[]): Geometry {
  const r = parseGeometryText(geo(parts, palette));
  if (!r.ok) throw new Error(`parse failed: ${r.message}`);
  return r.value;
}

const RED = ['#F00'];

// Lint helper: returns the diagnostics filtered to a specific ruleId, for
// targeted assertions. Each rule's positive/negative cases assert via this
// helper so unrelated lints don't bleed into the comparison.
function ofRule(geometry: Geometry, ruleId: string) {
  return lintGeometry(geometry).filter((d) => d.ruleId === ruleId);
}

const SOLID_2x2x2: string[][] = [
  ['00', '00'],
  ['00', '00'],
];

describe('lintGeometry — W01 pivot outside grid bounds', () => {
  it('does not fire when pivot is inside the bounding box', () => {
    const geometry = model(
      [{ name: 'p', size: [2, 2, 2], pivot: [1, 1, 1], voxels: SOLID_2x2x2 }],
      RED,
    );
    expect(ofRule(geometry, 'W01')).toEqual([]);
  });

  it('does not fire when pivot is on the boundary (inclusive)', () => {
    // [W, H, D] corner is still in-bounds — coords span 0..size.dim inclusive.
    const geometry = model(
      [{ name: 'p', size: [2, 2, 2], pivot: [2, 2, 2], voxels: SOLID_2x2x2 }],
      RED,
    );
    expect(ofRule(geometry, 'W01')).toEqual([]);
  });

  it('fires when pivot x exceeds W', () => {
    const geometry = model(
      [{ name: 'p', size: [2, 1, 2], pivot: [3, 0, 1], voxels: [['00', '00']] }],
      RED,
    );
    const diags = ofRule(geometry, 'W01');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toMatch(/pivot.*\[3, 0, 1\].*outside grid bounds.*part 'p'/);
  });

  it('fires when pivot has negative coordinate', () => {
    const geometry = model(
      [{ name: 'p', size: [2, 1, 2], pivot: [-1, 0, 1], voxels: [['00', '00']] }],
      RED,
    );
    expect(ofRule(geometry, 'W01')).toHaveLength(1);
  });
});

describe('lintGeometry — W02 socket outside grid bounds', () => {
  it('does not fire when socket is inside the bounding box', () => {
    const geometry = model(
      [
        {
          name: 'p',
          size: [2, 2, 2],
          voxels: SOLID_2x2x2,
          sockets: [{ name: 's', pos: [1, 1, 1] }],
        },
      ],
      RED,
    );
    expect(ofRule(geometry, 'W02')).toEqual([]);
  });

  it('fires once per offending socket, in declaration order', () => {
    const geometry = model(
      [
        {
          name: 'p',
          size: [2, 1, 2],
          voxels: [['00', '00']],
          sockets: [
            { name: 'a', pos: [5, 0, 0] },
            { name: 'b', pos: [0, 0, -1] },
          ],
        },
      ],
      RED,
    );
    const diags = ofRule(geometry, 'W02');
    expect(diags).toHaveLength(2);
    expect(diags[0]?.message).toMatch(/socket 'a'/);
    expect(diags[1]?.message).toMatch(/socket 'b'/);
  });
});

describe('lintGeometry — W03 palette index unused', () => {
  it('does not fire when every palette index is referenced', () => {
    const geometry = model(
      [{ name: 'p', size: [2, 1, 2], voxels: [['01', '10']] }],
      ['#F00', '#0F0'],
    );
    expect(ofRule(geometry, 'W03')).toEqual([]);
  });

  it('fires for each unused index', () => {
    // 3-color palette but only index 0 is used.
    const geometry = model(
      [{ name: 'p', size: [2, 1, 2], voxels: [['00', '00']] }],
      ['#F00', '#0F0', '#00F'],
    );
    const diags = ofRule(geometry, 'W03');
    expect(diags).toHaveLength(2);
    expect(diags[0]?.message).toMatch(/palette index 1/);
    expect(diags[1]?.message).toMatch(/palette index 2/);
  });

  it('counts usage across all parts, not just one', () => {
    // Index 1 is used only by part b; without cross-part scanning, W03 would
    // incorrectly fire.
    const geometry = model(
      [
        { name: 'a', size: [1, 1, 1], voxels: [['0']] },
        { name: 'b', size: [1, 1, 1], voxels: [['1']] },
      ],
      ['#F00', '#0F0'],
    );
    expect(ofRule(geometry, 'W03')).toEqual([]);
  });

  it('does not count AIR (.) as usage', () => {
    // Palette has 1 color but every cell is AIR — index 0 is unused, fires.
    // (W05 also fires; that's tested separately.)
    const geometry = model([{ name: 'p', size: [1, 1, 1], voxels: [['.']] }], RED);
    expect(ofRule(geometry, 'W03')).toHaveLength(1);
  });
});

describe('lintGeometry — W04 / W05 emptiness', () => {
  it('W04 fires per empty layer in an otherwise-solid part', () => {
    // y=0 solid, y=1 empty, y=2 solid → W04 for y=1 only.
    const geometry = model(
      [{ name: 'p', size: [1, 3, 1], voxels: [['0'], ['.'], ['0']] }],
      RED,
    );
    const w04 = ofRule(geometry, 'W04');
    expect(w04).toHaveLength(1);
    expect(w04[0]?.message).toMatch(/layer y=1/);
    expect(ofRule(geometry, 'W05')).toEqual([]);
  });

  it('W05 fires when every layer is empty, and W04 is suppressed', () => {
    const geometry = model(
      [{ name: 'p', size: [1, 2, 1], voxels: [['.'], ['.']] }],
      RED,
    );
    expect(ofRule(geometry, 'W05')).toHaveLength(1);
    expect(ofRule(geometry, 'W04')).toEqual([]); // suppressed
  });

  it('neither fires when every layer has at least one solid cell', () => {
    const geometry = model(
      [{ name: 'p', size: [2, 2, 2], voxels: SOLID_2x2x2 }],
      RED,
    );
    expect(ofRule(geometry, 'W04')).toEqual([]);
    expect(ofRule(geometry, 'W05')).toEqual([]);
  });
});

describe('lintGeometry — H01 part name convention', () => {
  const named = (name: string) =>
    model([{ name, size: [1, 1, 1], voxels: [['0']] }], RED);

  it('accepts lower_snake_case', () => {
    expect(ofRule(named('head_top'), 'H01')).toEqual([]);
  });

  it('accepts lower-kebab-case', () => {
    expect(ofRule(named('head-top'), 'H01')).toEqual([]);
  });

  it('accepts a single lowercase word with digits', () => {
    expect(ofRule(named('arm1'), 'H01')).toEqual([]);
  });

  it('fires for CamelCase', () => {
    expect(ofRule(named('Head'), 'H01')).toHaveLength(1);
  });

  it('fires for leading underscore', () => {
    expect(ofRule(named('_head'), 'H01')).toHaveLength(1);
  });

  it('fires for trailing separator', () => {
    expect(ofRule(named('head_'), 'H01')).toHaveLength(1);
  });
});

describe('lintGeometry — H02 fractional pivot', () => {
  it('does not fire for integer pivots', () => {
    const geometry = model(
      [{ name: 'p', size: [2, 2, 2], pivot: [1, 0, 1], voxels: SOLID_2x2x2 }],
      RED,
    );
    expect(ofRule(geometry, 'H02')).toEqual([]);
  });

  it('does not fire when the fractional pivot equals the geometric default', () => {
    // size 3 → default pivot [1.5, 0, 1.5]; not a typo, just the center.
    const geometry = model(
      [{ name: 'p', size: [3, 1, 3], voxels: [['000', '000', '000']] }],
      RED,
    );
    expect(ofRule(geometry, 'H02')).toEqual([]);
  });

  it('fires when pivot is fractional and not the default', () => {
    // size 4 → default [2, 0, 2] (integer); user wrote 2.5 → likely typo.
    const geometry = model(
      [
        {
          name: 'p',
          size: [4, 1, 4],
          pivot: [2.5, 0, 2],
          voxels: [['0000', '0000', '0000', '0000']],
        },
      ],
      RED,
    );
    const diags = ofRule(geometry, 'H02');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe('hint');
  });
});

// The lint rules operate on the AST, so they are unaffected by the container —
// but the corpus they run against is now JSON, and reading it through the real
// reader is what makes this a parity check rather than a unit test.
describe('lintGeometry — corpus parity', () => {
  async function loadCorpus(path: string) {
    const r = parseGeometryText(await readFixtureText(path));
    if (!r.ok) throw new Error(`${path}: ${r.message}`);
    return r.value;
  }

  it('wolf model produces no lint diagnostics', async () => {
    expect(lintGeometry(await loadCorpus('models/wolf/voxels.json'))).toEqual([]);
  });

  it('crown model produces no lint diagnostics', async () => {
    expect(lintGeometry(await loadCorpus('models/crown/voxels.json'))).toEqual([]);
  });
});

describe('lintGeometry — output structure', () => {
  it('every diagnostic carries a ruleId matching the W/H pattern', () => {
    const geometry = model(
      [
        {
          name: 'Bad',
          size: [2, 1, 2],
          pivot: [5, 0, 0],
          voxels: [['..', '..']],
          sockets: [{ name: 's', pos: [9, 0, 0] }],
        },
      ],
      ['#F00', '#0F0'],
    );
    const diags = lintGeometry(geometry);
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.ruleId).toMatch(/^[WH]\d{2}$/);
      expect(d.severity === 'warning' || d.severity === 'hint').toBe(true);
    }
  });

  it('per-part rules run in part declaration order', () => {
    const geometry = model(
      [
        { name: 'Bad1', size: [1, 1, 1], voxels: [['.']] },
        { name: 'Bad2', size: [1, 1, 1], voxels: [['.']] },
      ],
      RED,
    );
    const h01 = ofRule(geometry, 'H01');
    expect(h01).toHaveLength(2);
    expect(h01[0]?.message).toMatch(/'Bad1'/);
    expect(h01[1]?.message).toMatch(/'Bad2'/);
  });
});
