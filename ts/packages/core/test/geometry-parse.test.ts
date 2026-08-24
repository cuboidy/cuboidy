import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGeometry, parseGeometryText } from '../src/geometry/parse.js';
import {
  serializeGeometry,
  SPEC_VERSION,
} from '../src/geometry/serialize.js';
import { RIGGED, RIGGED_PARTS, SINGLE } from './helpers/corpus.js';

// A minimal valid document, spread into per-case overrides so each test shows
// only the field it is about.
function doc(overrides: Record<string, unknown> = {}) {
  return {
    version: SPEC_VERSION,
    palette: ['#FFD700'],
    parts: [{ name: 'crown', size: [2, 1, 2], voxels: [['00', '00']] }],
    ...overrides,
  };
}

function part(overrides: Record<string, unknown> = {}) {
  return {
    parts: [
      { name: 'crown', size: [2, 1, 2], voxels: [['00', '00']], ...overrides },
    ],
  };
}

describe('parseGeometry — structure', () => {
  it('accepts a minimal document', () => {
    const r = parseGeometry(doc());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts).toHaveLength(1);
    expect(r.value.palette).toHaveLength(1);
    expect(r.value.parts[0]!.voxels).toEqual([[[0, 0], [0, 0]]]);
  });

  it('rejects an unknown top-level field', () => {
    const r = parseGeometry(doc({ extra: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unknown');
  });

  it('rejects an unknown part field', () => {
    const r = parseGeometry(part({ colour: 'red' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unknown');
  });

  it('reports a missing required field as `missing`', () => {
    const r = parseGeometry({ version: SPEC_VERSION });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing');
  });

  it('reports an empty parts array as `missing`', () => {
    const r = parseGeometry(doc({ parts: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing');
  });

  it('reports a missing `size` as `missing`', () => {
    const r = parseGeometry({
      parts: [{ name: 'crown', voxels: [['00', '00']] }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing');
  });
});

describe('parseGeometry — identifiers (SPEC §5)', () => {
  it('rejects a reserved keyword as a part name', () => {
    const r = parseGeometry(part({ name: 'pivot' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-value');
  });

  it('rejects a leading digit', () => {
    const r = parseGeometry(part({ name: '1head' }));
    expect(r.ok).toBe(false);
  });

  it('accepts hyphenated names', () => {
    expect(parseGeometry(part({ name: 'leg-fl' })).ok).toBe(true);
  });

  it('rejects a duplicate part name', () => {
    const r = parseGeometry({
      parts: [
        { name: 'a', size: [1, 1, 1], voxels: [['0']] },
        { name: 'a', size: [1, 1, 1], voxels: [['0']] },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('duplicate');
  });
});

describe('parseGeometry — size (SPEC §7.6)', () => {
  it('rejects a zero dimension', () => {
    const r = parseGeometry(part({ size: [0, 1, 1], voxels: [[]] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-value');
  });

  it('rejects a fractional dimension', () => {
    expect(parseGeometry(part({ size: [1.5, 1, 1] })).ok).toBe(false);
  });

  it('rejects a dimension above 1024', () => {
    expect(parseGeometry(part({ size: [1025, 1, 1] })).ok).toBe(false);
  });

  it('rejects a two-element size', () => {
    const r = parseGeometry(part({ size: [2, 2] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('wrong-arity');
  });
});

describe('parseGeometry — voxel arity (SPEC §7.9)', () => {
  it('rejects a layer count that disagrees with H', () => {
    const r = parseGeometry(part({ size: [2, 2, 2], voxels: [['00', '00']] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('wrong-arity');
    expect(r.message).toContain('expected H=2');
  });

  it('rejects a row count that disagrees with D', () => {
    const r = parseGeometry(part({ size: [2, 1, 3], voxels: [['00', '00']] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('wrong-arity');
    expect(r.message).toContain('expected D=3');
  });

  it('rejects a row width that disagrees with W', () => {
    const r = parseGeometry(part({ size: [3, 1, 2], voxels: [['00', '000']] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('wrong-arity');
    expect(r.message).toContain('expected W=3');
  });

  it('rejects a character outside the alphabet', () => {
    const r = parseGeometry(part({ voxels: [['0#', '00']] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-value');
  });
});

describe('parseGeometry — palette (SPEC §7.4)', () => {
  it('maps the alphabet to indices', () => {
    const r = parseGeometry({
      palette: Array.from({ length: 64 }, () => '#FFFFFF'),
      parts: [{ name: 'p', size: [6, 1, 1], voxels: [['09aZ$%']] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // '0'→0, '9'→9, 'a'→10, 'Z'→61
    expect(r.value.parts[0]!.voxels[0]![0]).toEqual([0, 9, 10, 61, 62, 63]);
  });

  it('treats `.` as air', () => {
    const r = parseGeometry(part({ voxels: [['0.', '..']] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts[0]!.voxels[0]![0]).toEqual([0, -1]);
  });

  it('rejects an index beyond the declared palette', () => {
    // `part()` declares no palette, so the range check would be deferred —
    // this case needs the one-colour palette from `doc()`.
    const r = parseGeometry(doc({ ...part({ voxels: [['01', '00']] }) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-value');
    expect(r.message).toContain('palette has 1');
  });

  it('defers the range check when no palette is declared', () => {
    // SPEC §7.4: cross-file validation owns this case (§11.6).
    const r = parseGeometry({
      parts: [{ name: 'p', size: [2, 1, 1], voxels: [['5z']] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.palette).toEqual([]);
  });

  it('accepts all four hex forms (SPEC §7.4)', () => {
    for (const hex of ['#FD7', '#FD7A', '#FFD700', '#FFD700AA']) {
      expect(parseGeometry(doc({ palette: [hex] })).ok).toBe(true);
    }
  });

  it('rejects a malformed colour', () => {
    expect(parseGeometry(doc({ palette: ['FFD700'] })).ok).toBe(false); // no #
    expect(parseGeometry(doc({ palette: ['#FFD70'] })).ok).toBe(false); // 5 digits
    expect(parseGeometry(doc({ palette: ['#GGGGGG'] })).ok).toBe(false); // not hex
  });

  it('rejects more than 64 colours', () => {
    const r = parseGeometry(
      doc({ palette: Array.from({ length: 65 }, () => '#FFFFFF') }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('wrong-arity');
  });
});

describe('parseGeometry — pivot and sockets (SPEC §7.7, §7.8)', () => {
  it('fills the bottom-center default when pivot is absent', () => {
    const r = parseGeometry(part({ size: [4, 2, 6] , voxels: [
      ['0000','0000','0000','0000','0000','0000'],
      ['0000','0000','0000','0000','0000','0000'],
    ]}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts[0]!.pivot).toEqual({ pos: { x: 2, y: 0, z: 3 } });
  });

  it('keeps a declared pivot and its rotation', () => {
    const r = parseGeometry(part({ pivot: { pos: [1, 0, 1], rot: [0, 90, 0] } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts[0]!.pivot).toEqual({
      pos: { x: 1, y: 0, z: 1 },
      rot: { x: 0, y: 90, z: 0 },
    });
  });

  it('accepts a fractional pivot', () => {
    expect(parseGeometry(part({ pivot: { pos: [1.5, 0, 1.5] } })).ok).toBe(true);
  });

  it('rejects a duplicate socket name within a part', () => {
    const r = parseGeometry(
      part({
        sockets: [
          { name: 'hat', pos: [0, 0, 0] },
          { name: 'hat', pos: [1, 0, 0] },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('duplicate');
  });

  it('defaults sockets to an empty list', () => {
    const r = parseGeometry(part());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts[0]!.sockets).toEqual([]);
  });
});

describe('parseGeometryText', () => {
  it('reports a syntax error as invalid-value', () => {
    const r = parseGeometryText('{ "parts": [ }');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-value');
    expect(r.message).toContain('invalid JSON');
  });

  it('round-trips the serializer output', () => {
    const original = parseGeometry(doc());
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    const back = parseGeometryText(serializeGeometry(original.value));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual(original.value);
  });
});

// The shipped corpus is the acceptance test. Reading it back and writing it
// out again must be a fixed point, or the format cannot be edited by tooling
// without churning every file it touches.
describe('the corpus', () => {
  const repo = join(import.meta.dirname, '..', '..', '..', '..');
  const modelsDir = join(repo, 'models');

  const files: Array<{ label: string; text: string }> = [];
  // Directories only: a model is a FOLDER (SPEC §3), and the gallery may
  // sit beside loose files that are not models — a workspace scene saved
  // into it, for one. Assuming every entry was a directory made an
  // unrelated file crash the whole suite.
  for (const entry of readdirSync(modelsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    for (const f of readdirSync(join(modelsDir, dir))) {
      if (!f.endsWith('.json') || f === 'cuboidy.json' || f === 'palette.json') continue;
      files.push({
        label: `${dir}/${f}`,
        text: readFileSync(join(modelsDir, dir, f), 'utf8'),
      });
    }
  }

  it('found the corpus', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const { label, text } of files) {
    it(`${label} parses and is a serializer fixed point`, () => {
      const first = parseGeometryText(text);
      expect(first.ok, label).toBe(true);
      if (!first.ok) return;

      // Byte-level idempotence: the committed file is already canonical, so a
      // tool that reads and writes it produces no diff.
      const written = serializeGeometry(first.value);
      expect(written, `${label} is not canonical on disk`).toBe(text);

      const second = parseGeometryText(written);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value).toEqual(first.value);
    });
  }

  // Structural assertions on the test corpus. These used to pin two shipped
  // models; they moved here so the example gallery can be replaced without
  // rewriting parser tests. What is still asserted about `models/` is the
  // round-trip above, which is discovered by walking the directory.
  it('the rigged corpus model has the expected rig, pivot and sockets', () => {
    const r = parseGeometryText(
      readFileSync(join(repo, RIGGED, 'voxels.json'), 'utf8'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.palette).toHaveLength(3);
    expect(r.value.parts.map((p) => p.name)).toEqual(
      RIGGED_PARTS.map((p) => p.name),
    );

    const head = r.value.parts.find((p) => p.name === 'head')!;
    expect(head.size).toEqual({ w: 4, h: 4, d: 4 });
    // A non-default pivot: back-bottom-centre, the connection point.
    expect(head.pivot.pos).toEqual({ x: 2, y: 0, z: 4 });
    expect(head.sockets.map((s) => s.name)).toEqual(['hat', 'mouth']);
    expect(head.voxels).toHaveLength(4);
    // Top layer carries the two-tone row `1221`.
    expect(head.voxels[3]?.[0]).toEqual([1, 2, 2, 1]);
  });

  it('the single-part corpus model parses as one part', () => {
    const r = parseGeometryText(
      readFileSync(join(repo, SINGLE, 'voxels.json'), 'utf8'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.palette).toHaveLength(1);
    expect(r.value.parts).toHaveLength(1);
    expect(r.value.parts[0]?.name).toBe('cap');
    expect(r.value.parts[0]?.size).toEqual({ w: 3, h: 2, d: 3 });
  });
});
