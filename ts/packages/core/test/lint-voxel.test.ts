import { describe, expect, it } from 'vitest';
import { parseCvox } from '../src/cvox/parse.js';
import { lintCvox } from '../src/lint/voxel-rules.js';
import type { Cvox } from '../src/cvox/types.js';
import { readFixtureText } from './helpers/fixtures.js';

function unwrap(input: string): Cvox {
  const r = parseCvox(input);
  if (!r.ok) throw new Error(`parse failed: ${r.message}`);
  return r.value;
}

// Lint helper: returns the diagnostics filtered to a specific ruleId, for
// targeted assertions. Each rule's positive/negative cases assert via this
// helper so unrelated lints don't bleed into the comparison.
function ofRule(cvox: Cvox, ruleId: string) {
  return lintCvox(cvox).filter((d) => d.ruleId === ruleId);
}

describe('lintCvox — W01 pivot outside grid bounds', () => {
  it('does not fire when pivot is inside the bounding box', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 2 2 2\npivot 1 1 1\nvoxels { 00 00 , 00 00 }');
    expect(ofRule(cvox, 'W01')).toEqual([]);
  });

  it('does not fire when pivot is on the boundary (inclusive)', () => {
    // [W, H, D] corner is still in-bounds — coords span 0..size.dim inclusive.
    const cvox = unwrap('palette #F00\npart p\nsize 2 2 2\npivot 2 2 2\nvoxels { 00 00 , 00 00 }');
    expect(ofRule(cvox, 'W01')).toEqual([]);
  });

  it('fires when pivot x exceeds W', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 2 1 2\npivot 3 0 1\nvoxels { 00 00 }');
    const diags = ofRule(cvox, 'W01');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toMatch(/pivot.*\[3, 0, 1\].*outside grid bounds.*part 'p'/);
  });

  it('fires when pivot has negative coordinate', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 2 1 2\npivot -1 0 1\nvoxels { 00 00 }');
    expect(ofRule(cvox, 'W01')).toHaveLength(1);
  });
});

describe('lintCvox — W02 socket outside grid bounds', () => {
  it('does not fire when socket is inside the bounding box', () => {
    const cvox = unwrap(
      'palette #F00\npart p\nsize 2 2 2\nsocket s 1 1 1\nvoxels { 00 00 , 00 00 }',
    );
    expect(ofRule(cvox, 'W02')).toEqual([]);
  });

  it('fires once per offending socket, in declaration order', () => {
    const cvox = unwrap(
      'palette #F00\npart p\nsize 2 1 2\nsocket a 5 0 0\nsocket b 0 0 -1\nvoxels { 00 00 }',
    );
    const diags = ofRule(cvox, 'W02');
    expect(diags).toHaveLength(2);
    expect(diags[0]?.message).toMatch(/socket 'a'/);
    expect(diags[1]?.message).toMatch(/socket 'b'/);
  });
});

describe('lintCvox — W03 palette index unused', () => {
  it('does not fire when every palette index is referenced', () => {
    const cvox = unwrap('palette #F00 #0F0\npart p\nsize 2 1 2\nvoxels { 01 10 }');
    expect(ofRule(cvox, 'W03')).toEqual([]);
  });

  it('fires for each unused index', () => {
    // 3-color palette but only index 0 is used.
    const cvox = unwrap('palette #F00 #0F0 #00F\npart p\nsize 2 1 2\nvoxels { 00 00 }');
    const diags = ofRule(cvox, 'W03');
    expect(diags).toHaveLength(2);
    expect(diags[0]?.message).toMatch(/palette index 1/);
    expect(diags[1]?.message).toMatch(/palette index 2/);
  });

  it('counts usage across all parts, not just one', () => {
    // Index 1 is used only by part b; without cross-part scanning, W03 would
    // incorrectly fire.
    const cvox = unwrap(
      'palette #F00 #0F0\npart a\nsize 1 1 1\nvoxels { 0 }\npart b\nsize 1 1 1\nvoxels { 1 }',
    );
    expect(ofRule(cvox, 'W03')).toEqual([]);
  });

  it('does not count AIR (.) as usage', () => {
    // Palette has 1 color but every cell is AIR — index 0 is unused, fires.
    // (W05 also fires; that's tested separately.)
    const cvox = unwrap('palette #F00\npart p\nsize 1 1 1\nvoxels { . }');
    expect(ofRule(cvox, 'W03')).toHaveLength(1);
  });
});

describe('lintCvox — W04 / W05 emptiness', () => {
  it('W04 fires per empty layer in an otherwise-solid part', () => {
    // y=0 solid, y=1 empty, y=2 solid → W04 for y=1 only.
    const cvox = unwrap(
      'palette #F00\npart p\nsize 1 3 1\nvoxels { 0 , . , 0 }',
    );
    const w04 = ofRule(cvox, 'W04');
    expect(w04).toHaveLength(1);
    expect(w04[0]?.message).toMatch(/layer y=1/);
    expect(ofRule(cvox, 'W05')).toEqual([]);
  });

  it('W05 fires when every layer is empty, and W04 is suppressed', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 1 2 1\nvoxels { . , . }');
    expect(ofRule(cvox, 'W05')).toHaveLength(1);
    expect(ofRule(cvox, 'W04')).toEqual([]); // suppressed
  });

  it('neither fires when every layer has at least one solid cell', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 2 2 2\nvoxels { 00 00 , 00 00 }');
    expect(ofRule(cvox, 'W04')).toEqual([]);
    expect(ofRule(cvox, 'W05')).toEqual([]);
  });
});

describe('lintCvox — H01 part name convention', () => {
  it('accepts lower_snake_case', () => {
    const cvox = unwrap('palette #F00\npart head_top\nsize 1 1 1\nvoxels { 0 }');
    expect(ofRule(cvox, 'H01')).toEqual([]);
  });

  it('accepts lower-kebab-case', () => {
    const cvox = unwrap('palette #F00\npart head-top\nsize 1 1 1\nvoxels { 0 }');
    expect(ofRule(cvox, 'H01')).toEqual([]);
  });

  it('accepts a single lowercase word with digits', () => {
    const cvox = unwrap('palette #F00\npart arm1\nsize 1 1 1\nvoxels { 0 }');
    expect(ofRule(cvox, 'H01')).toEqual([]);
  });

  it('fires for CamelCase', () => {
    const cvox = unwrap('palette #F00\npart Head\nsize 1 1 1\nvoxels { 0 }');
    expect(ofRule(cvox, 'H01')).toHaveLength(1);
  });

  it('fires for leading underscore', () => {
    const cvox = unwrap('palette #F00\npart _head\nsize 1 1 1\nvoxels { 0 }');
    expect(ofRule(cvox, 'H01')).toHaveLength(1);
  });

  it('fires for trailing separator', () => {
    const cvox = unwrap('palette #F00\npart head_\nsize 1 1 1\nvoxels { 0 }');
    expect(ofRule(cvox, 'H01')).toHaveLength(1);
  });
});

describe('lintCvox — H02 fractional pivot', () => {
  it('does not fire for integer pivots', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 2 2 2\npivot 1 0 1\nvoxels { 00 00 , 00 00 }');
    expect(ofRule(cvox, 'H02')).toEqual([]);
  });

  it('does not fire when the fractional pivot equals the geometric default', () => {
    // size 3 → default pivot [1.5, 0, 1.5]; not a typo, just the center.
    const cvox = unwrap('palette #F00\npart p\nsize 3 1 3\nvoxels { 000 000 000 }');
    expect(ofRule(cvox, 'H02')).toEqual([]);
  });

  it('fires when pivot is fractional and not the default', () => {
    // size 4 → default [2, 0, 2] (integer); user wrote 2.5 → likely typo.
    const cvox = unwrap(
      'palette #F00\npart p\nsize 4 1 4\npivot 2.5 0 2\nvoxels { 0000 0000 0000 0000 }',
    );
    const diags = ofRule(cvox, 'H02');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe('hint');
  });
});

describe('lintCvox — fixture parity', () => {
  it('wolf model produces no lint diagnostics', async () => {
    const text = await readFixtureText('models/wolf/voxels.cvox');
    const cvox = unwrap(text);
    expect(lintCvox(cvox)).toEqual([]);
  });

  it('crown model produces no lint diagnostics', async () => {
    const text = await readFixtureText('models/crown/voxels.cvox');
    const cvox = unwrap(text);
    expect(lintCvox(cvox)).toEqual([]);
  });
});

describe('lintCvox — output structure', () => {
  it('every diagnostic carries a ruleId matching the W/H pattern', () => {
    const cvox = unwrap(
      'palette #F00 #0F0\npart Bad\nsize 2 1 2\npivot 5 0 0\nsocket s 9 0 0\nvoxels { .. .. }',
    );
    const diags = lintCvox(cvox);
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.ruleId).toMatch(/^[WH]\d{2}$/);
      expect(d.severity === 'warning' || d.severity === 'hint').toBe(true);
    }
  });

  it('per-part rules run in part declaration order', () => {
    const cvox = unwrap(
      'palette #F00\npart Bad1\nsize 1 1 1\nvoxels { . }\npart Bad2\nsize 1 1 1\nvoxels { . }',
    );
    const h01 = ofRule(cvox, 'H01');
    expect(h01).toHaveLength(2);
    expect(h01[0]?.message).toMatch(/'Bad1'/);
    expect(h01[1]?.message).toMatch(/'Bad2'/);
  });
});
