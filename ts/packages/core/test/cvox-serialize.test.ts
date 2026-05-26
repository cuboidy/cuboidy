import { describe, expect, it } from 'vitest';
import { parseCvox } from '../src/cvox/parse.js';
import { serializeCvox } from '../src/cvox/serialize.js';
import type { Cvox } from '../src/cvox/types.js';

function unwrap(input: string): Cvox {
  const r = parseCvox(input);
  if (!r.ok) throw new Error(`parse failed: ${r.message}`);
  return r.value;
}

describe('serializeCvox — canonical output shape', () => {
  it('emits palette on the first line, then a blank line, then parts', () => {
    const cvox = unwrap('palette #FFD700\npart crown\nsize 1 1 1\nvoxels { 0 }');
    const text = serializeCvox(cvox);
    expect(text).toBe(
      'palette #FFD700\n' +
        '\n' +
        'part crown\n' +
        '    size 1 1 1\n' +
        '    voxels {\n' +
        '        0\n' +
        '    }\n',
    );
  });

  it('emits #RRGGBB without alpha when alpha = 0xFF', () => {
    const cvox = unwrap('palette #F00\npart p\nsize 1 1 1\nvoxels { 0 }');
    expect(serializeCvox(cvox)).toContain('palette #FF0000\n');
  });

  it('emits #RRGGBBAA when alpha < 0xFF', () => {
    const cvox = unwrap('palette #F008\npart p\nsize 1 1 1\nvoxels { 0 }');
    expect(serializeCvox(cvox)).toContain('palette #FF000088\n');
  });

  it('uppercases hex digits regardless of source case', () => {
    const cvox = unwrap('palette #abcdef\npart p\nsize 1 1 1\nvoxels { 0 }');
    expect(serializeCvox(cvox)).toContain('palette #ABCDEF\n');
  });

  it('uses 4-space indent for part body', () => {
    const cvox = unwrap('palette #FFF\npart p\nsize 2 1 2\nvoxels { 00 00 }');
    const text = serializeCvox(cvox);
    expect(text).toContain('    size 2 1 2');
    expect(text).toContain('    voxels {');
    expect(text).toContain('        00'); // rows at 8 spaces (indent x 2)
  });

  it('emits sockets in declared order, one per line', () => {
    const cvox = unwrap(
      'palette #FFF\npart p\nsize 1 1 1\nsocket hat 0 1 0\nsocket mouth 0 0 0\nvoxels { 0 }',
    );
    const text = serializeCvox(cvox);
    const hatIdx = text.indexOf('socket hat 0 1 0');
    const mouthIdx = text.indexOf('socket mouth 0 0 0');
    expect(hatIdx).toBeGreaterThan(-1);
    expect(mouthIdx).toBeGreaterThan(hatIdx);
  });

  it('includes rot triple when socket has rotation', () => {
    const cvox = unwrap(
      'palette #FFF\npart p\nsize 1 1 1\nsocket hat 0 1 0 rot 0 90 0\nvoxels { 0 }',
    );
    expect(serializeCvox(cvox)).toContain('socket hat 0 1 0 rot 0 90 0');
  });

  it('preserves fractional coords (e.g. 1.5) as-is', () => {
    const cvox = unwrap(
      'palette #FFF\npart p\nsize 3 1 3\npivot 1.5 0 1.5\nvoxels { 000 000 000 }',
    );
    const text = serializeCvox(cvox);
    // 1.5 is the default for size 3 → pivot omitted per SPEC §7.7
    expect(text).not.toContain('pivot');
  });

  it('separates voxel layers with `,` on its own line', () => {
    const cvox = unwrap(
      'palette #FFF\npart stack\nsize 1 2 1\nvoxels { 0 , 0 }',
    );
    const text = serializeCvox(cvox);
    // Look for the canonical separator line
    expect(text).toMatch(/0\n {8},\n {8}0/);
  });

  it('emits multiple parts separated by blank lines', () => {
    const cvox = unwrap(
      'palette #FFF\npart a\nsize 1 1 1\nvoxels { 0 }\npart b\nsize 1 1 1\nvoxels { 0 }',
    );
    const text = serializeCvox(cvox);
    expect(text).toMatch(/}\n\npart b/);
  });
});

describe('serializeCvox — pivot omission rules (SPEC §7.7)', () => {
  it('omits pivot when it equals the bounding-box default and has no rotation', () => {
    // size 3x?x3 → default pivot [1.5, 0, 1.5]; rotation absent → omit
    const cvox = unwrap('palette #FFF\npart p\nsize 3 1 3\nvoxels { 000 000 000 }');
    expect(serializeCvox(cvox)).not.toContain('pivot');
  });

  it('emits pivot when position differs from the default', () => {
    const cvox = unwrap(
      'palette #FFF\npart p\nsize 3 1 3\npivot 0 0 0\nvoxels { 000 000 000 }',
    );
    expect(serializeCvox(cvox)).toContain('pivot 0 0 0');
  });

  it('emits pivot when rotation is present even if pos is default', () => {
    const cvox = unwrap(
      'palette #FFF\npart p\nsize 3 1 3\npivot 1.5 0 1.5 rot 0 0 90\nvoxels { 000 000 000 }',
    );
    expect(serializeCvox(cvox)).toContain('pivot 1.5 0 1.5 rot 0 0 90');
  });
});

describe('serializeCvox — round-trip', () => {
  // parse → serialize → parse should reproduce a structurally equal Cvox.
  // The serializer is the "writer-strict" side of the contract; the
  // round-trip property is the safety net that catches divergence between
  // the two halves.
  function roundTrip(input: string) {
    const first = unwrap(input);
    const text = serializeCvox(first);
    const second = unwrap(text);
    expect(second).toEqual(first);
    return text;
  }

  it('round-trips the wolf model', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(
      new URL('../../../../models/wolf/voxels.cvox', import.meta.url),
      'utf-8',
    );
    roundTrip(text);
  });

  it('round-trips the crown model', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(
      new URL('../../../../models/crown/voxels.cvox', import.meta.url),
      'utf-8',
    );
    roundTrip(text);
  });

  it('round-trips a part with rot on both pivot and socket', () => {
    roundTrip(
      'palette #F00 #0F0\n' +
        'part demo\n' +
        '  size 2 1 2\n' +
        '  pivot 0 0 0 rot 0 45 0\n' +
        '  socket anchor 1.5 0.5 0.5 rot 0 90 0\n' +
        '  voxels { 01 10 }',
    );
  });

  it('round-trips a multi-layer voxels block', () => {
    roundTrip(
      'palette #FFF\n' +
        'part stack\n' +
        '  size 2 3 2\n' +
        '  voxels {\n' +
        '    00 00\n' +
        '    ,\n' +
        '    0. .0\n' +
        '    ,\n' +
        '    .. ..\n' +
        '  }',
    );
  });
});

describe('serializeCvox — idempotence (canonical fixed point)', () => {
  // Re-serializing a canonical-form text must yield the same text.
  // Catches accidental drift in writer output (e.g. trailing whitespace,
  // line-ending inconsistencies).
  function expectIdempotent(input: string) {
    const once = serializeCvox(unwrap(input));
    const twice = serializeCvox(unwrap(once));
    expect(twice).toBe(once);
  }

  it('is idempotent for a minimal model', () => {
    expectIdempotent('palette #FFF\npart p\nsize 1 1 1\nvoxels { 0 }');
  });

  it('is idempotent for the wolf model', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(
      new URL('../../../../models/wolf/voxels.cvox', import.meta.url),
      'utf-8',
    );
    expectIdempotent(text);
  });
});
