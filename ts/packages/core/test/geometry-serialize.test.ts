import { describe, expect, it } from 'vitest';
import { parseGeometryText } from '../src/geometry/parse.js';
import {
  formatGeometryDoc,
  serializeGeometry,
  toGeometryDoc,
  SPEC_VERSION,
} from '../src/geometry/serialize.js';
import type { Cvox } from '../src/geometry/types.js';
import { geo } from './helpers/geometry.js';

// SPEC §7 canonical emission. The corpus fixed-point in geometry-parse.test.ts
// proves the writer is stable on real models; these cases pin the individual
// omission rules, which is where a regression would hide (an omitted field
// that starts being emitted still round-trips, so only an explicit test
// catches it).

function parse(text: string): Cvox {
  const r = parseGeometryText(text);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

const roundTrip = (text: string) => serializeGeometry(parse(text));

describe('toGeometryDoc — omission rules', () => {
  it('omits `palette` for a file that declares none (§7.4)', () => {
    const doc = toGeometryDoc(
      parse(geo([{ name: 'p', size: [1, 1, 1], voxels: [['.']] }])),
    );
    expect(doc.palette).toBeUndefined();
    expect(doc.version).toBe(SPEC_VERSION);
  });

  it('emits `palette` when the file declares one', () => {
    const doc = toGeometryDoc(
      parse(geo([{ name: 'p', size: [1, 1, 1], voxels: [['0']] }], ['#ff0000'])),
    );
    // Hex is normalised to upper case, and alpha 0xFF is dropped.
    expect(doc.palette).toEqual(['#FF0000']);
  });

  it('keeps the alpha channel when it is not opaque', () => {
    const doc = toGeometryDoc(
      parse(geo([{ name: 'p', size: [1, 1, 1], voxels: [['0']] }], ['#FF000080'])),
    );
    expect(doc.palette).toEqual(['#FF000080']);
  });

  it('omits `pivot` when it is the §7.7 bounding-box default', () => {
    // Default for a 2×1×2 part is [1, 0, 1] — declaring it explicitly must
    // still serialize back to absence.
    const doc = toGeometryDoc(
      parse(
        geo([
          { name: 'p', size: [2, 1, 2], pivot: [1, 0, 1], voxels: [['00', '00']] },
        ]),
      ),
    );
    expect(doc.parts[0]?.pivot).toBeUndefined();
  });

  it('emits `pivot` when the position differs from the default', () => {
    const doc = toGeometryDoc(
      parse(
        geo([
          { name: 'p', size: [2, 1, 2], pivot: [0, 0, 0], voxels: [['00', '00']] },
        ]),
      ),
    );
    expect(doc.parts[0]?.pivot).toEqual({ pos: [0, 0, 0] });
  });

  it('emits `pivot` when a rotation is present even at the default position', () => {
    const doc = toGeometryDoc(
      parse(
        geo([
          {
            name: 'p',
            size: [2, 1, 2],
            pivot: [1, 0, 1],
            pivotRot: [0, 45, 0],
            voxels: [['00', '00']],
          },
        ]),
      ),
    );
    expect(doc.parts[0]?.pivot).toEqual({ pos: [1, 0, 1], rot: [0, 45, 0] });
  });

  it('omits `sockets` when a part has none, and keeps declared order', () => {
    const bare = toGeometryDoc(
      parse(geo([{ name: 'p', size: [1, 1, 1], voxels: [['.']] }])),
    );
    expect(bare.parts[0]?.sockets).toBeUndefined();

    const withSockets = toGeometryDoc(
      parse(
        geo([
          {
            name: 'p',
            size: [1, 1, 1],
            voxels: [['.']],
            sockets: [
              { name: 'b', pos: [1, 0, 0] },
              { name: 'a', pos: [0, 0, 0], rot: [0, 90, 0] },
            ],
          },
        ]),
      ),
    );
    expect(withSockets.parts[0]?.sockets).toEqual([
      { name: 'b', pos: [1, 0, 0] },
      { name: 'a', pos: [0, 0, 0], rot: [0, 90, 0] },
    ]);
  });

  it('preserves fractional coordinates as written', () => {
    const doc = toGeometryDoc(
      parse(
        geo([
          { name: 'p', size: [2, 1, 1], pivot: [1.5, 0, 0.25], voxels: [['00']] },
        ]),
      ),
    );
    expect(doc.parts[0]?.pivot).toEqual({ pos: [1.5, 0, 0.25] });
  });
});

describe('formatGeometryDoc — layout', () => {
  const text = serializeGeometry(
    parse(
      geo(
        [
          {
            name: 'p',
            size: [2, 2, 2],
            pivot: [0, 0, 0],
            voxels: [
              ['00', '01'],
              ['10', '11'],
            ],
          },
        ],
        ['#FF0000', '#00FF00'],
      ),
    ),
  );

  it('keeps coordinate triples inline', () => {
    expect(text).toContain('"size": [2, 2, 2],');
    expect(text).toContain('"pivot": { "pos": [0, 0, 0] },');
  });

  it('puts one Y-layer per line', () => {
    expect(text).toContain('["00", "01"],');
    expect(text).toContain('["10", "11"]');
  });

  it('ends with exactly one newline', () => {
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('}\n\n')).toBe(false);
  });

  it('is valid JSON that parses back to the same document', () => {
    expect(parseGeometryText(text).ok).toBe(true);
    expect(formatGeometryDoc(toGeometryDoc(parse(text)))).toBe(text);
  });
});

describe('round-trip', () => {
  it('is a fixed point for a part with rot on both pivot and socket', () => {
    const text = geo([
      {
        name: 'p',
        size: [1, 1, 1],
        pivot: [0, 0, 0],
        pivotRot: [10, 20, 30],
        voxels: [['0']],
        sockets: [{ name: 's', pos: [0, 1, 0], rot: [0, 0, 90] }],
      },
    ], ['#FFFFFF']);
    expect(roundTrip(text)).toBe(text);
    expect(roundTrip(roundTrip(text))).toBe(text);
  });

  it('is a fixed point for a multi-part, multi-layer model', () => {
    const text = geo(
      [
        { name: 'a', size: [2, 2, 1], voxels: [['01'], ['10']] },
        { name: 'b', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['1']] },
      ],
      ['#000000', '#FFFFFF'],
    );
    expect(roundTrip(text)).toBe(text);
  });
});
