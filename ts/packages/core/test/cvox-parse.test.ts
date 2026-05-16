import { describe, expect, it } from 'vitest';
import { parseCvox } from '../src/cvox/parse.js';
import { readFixtureText } from './helpers/fixtures.js';

describe('parseCvox', () => {
  describe('positive', () => {
    it('parses wolf/voxels.cvox', async () => {
      const text = await readFixtureText('wolf/voxels.cvox');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.palette).toHaveLength(2);
      expect(r.value.parts).toHaveLength(3);
      expect(r.value.parts.map((p) => p.name)).toEqual([
        'body',
        'head',
        'tail',
      ]);

      const head = r.value.parts.find((p) => p.name === 'head')!;
      expect(head.size).toEqual({ w: 3, h: 3, d: 3 });
      expect(head.pivot).toEqual({ x: 1, y: 0, z: 1 });
      expect(head.sockets).toHaveLength(2);
      expect(head.sockets.map((s) => s.name)).toEqual(['hat', 'mouth']);
      expect(head.voxels).toHaveLength(3);
      expect(head.voxels[1]?.[2]).toEqual([1, 0, 1]);
    });

    it('parses crown/voxels.cvox', async () => {
      const text = await readFixtureText('crown/voxels.cvox');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.palette).toHaveLength(1);
      expect(r.value.parts).toHaveLength(1);
      expect(r.value.parts[0]?.name).toBe('crown');
      expect(r.value.parts[0]?.size).toEqual({ w: 3, h: 2, d: 3 });
    });

    it('applies default pivot [W/2, 0, D/2] when omitted', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 4 1 6',
        'layer 0',
        '0000',
        '0000',
        '0000',
        '0000',
        '0000',
        '0000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.pivot).toEqual({ x: 2, y: 0, z: 3 });
    });
  });

  describe('errors', () => {
    it('E01: rejects missing palette', () => {
      const text = 'part head\nsize 1 1 1\nlayer 0\n0';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E01');
    });

    it('E12: rejects duplicate part name', () => {
      const text = [
        'palette #FF0000',
        'part a',
        'size 1 1 1',
        'layer 0',
        '0',
        'part a',
        'size 1 1 1',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E12');
    });

    it('E14: rejects duplicate socket name within a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'socket s 0 0 0',
        'socket s 0 0 0',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E14');
    });

    it('E13: rejects part missing size', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E13');
    });

    it('accepts layer indices in any order (v0.2 free-order)', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 2 1',
        'layer 1',
        '0',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.parts[0]?.voxels).toHaveLength(2);
      }
    });

    it('E09: rejects duplicate layer index', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 2 1',
        'layer 0',
        '0',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E09');
    });

    it('E09: rejects layer index >= H', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'layer 5',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E09');
    });

    it('E10: rejects layer with too few rows', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 3 1 4',
        'layer 0',
        '000',
        '000',
        '000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E10');
    });

    it('E10: rejects layer with too many rows (caught on next layer)', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 3 2 2',
        'layer 0',
        '000',
        '000',
        '000', // extra
        'layer 1',
        '000',
        '000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E10');
    });

    it('E15: rejects duplicate palette declaration', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 1 1 1',
        'layer 0',
        '0',
        'palette #00FF00',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E15');
    });

    it('E19: rejects file with palette but no parts', () => {
      const text = 'palette #FF0000';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E19');
    });

    it('E17: rejects duplicate size in a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'size 2 2 2',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E17');
    });

    it('E17: rejects duplicate pivot in a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'pivot 0 0 0',
        'pivot 0 0 0',
        'layer 0',
        '0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E17');
    });
  });

  describe('v0.2 free-order parsing', () => {
    it('parses inline layer rows', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 3 1 3',
        'layer 0 000 000 000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.parts[0]?.voxels).toEqual([
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        ]);
      }
    });

    it('parses mixed inline + multi-line layer rows', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 3 1 4',
        'layer 0 000 000',
        '000',
        '000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.voxels[0]).toHaveLength(4);
    });

    it('parses palette declared after parts', () => {
      const text = [
        'part box',
        '    size 1 1 1',
        '    layer 0  0',
        '',
        'palette #FF0000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.palette).toHaveLength(1);
    });

    it('parses metadata in any order (pivot before size, socket before size)', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '    pivot 1 0 1',
        '    socket s 0 0 0',
        '    layer 0  0',
        '    size 1 1 1',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.parts[0]?.pivot).toEqual({ x: 1, y: 0, z: 1 });
        expect(r.value.parts[0]?.sockets).toHaveLength(1);
      }
    });

    it('parses with full-line and trailing comments', () => {
      const text = [
        '// the box model',
        'palette #FF0000  // red',
        '',
        'part box  // the box',
        '    size 1 1 1',
        '    layer 0  0  // filled',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
    });

    it('parses indented metadata under part (whitespace tolerance)', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '        size 1 1 1',
        '        layer 0  0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
    });

    it('palette mid-part does not close the part (v0.2 §7.5)', () => {
      // palette appears between size and layer; the part should remain open.
      const text = [
        'part box',
        '    size 1 1 1',
        '    palette #FF0000',
        '    layer 0  0',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.parts).toHaveLength(1);
        expect(r.value.parts[0]?.name).toBe('box');
        expect(r.value.parts[0]?.voxels).toEqual([[[0]]]);
      }
    });

    it('layer indices in any order produce voxels at the correct Y slot', () => {
      // Confirms that out-of-order declarations are reassembled by index,
      // not by declaration order.
      const text = [
        'palette #FF0000 #00FF00',
        'part stack',
        '    size 1 3 1',
        '    layer 2  1',
        '    layer 0  0',
        '    layer 1  1',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        // voxels[y][z][x]; y is the layer index
        expect(r.value.parts[0]?.voxels[0]?.[0]?.[0]).toBe(0); // layer 0
        expect(r.value.parts[0]?.voxels[1]?.[0]?.[0]).toBe(1); // layer 1
        expect(r.value.parts[0]?.voxels[2]?.[0]?.[0]).toBe(1); // layer 2
      }
    });

    it('metadata between rows closes the active layer (E10)', () => {
      // A non-row keyword arriving while the active layer has not received
      // its full D rows must report E10 immediately, not silently consume
      // later rows into the same layer.
      const text = [
        'palette #FF0000',
        'part head',
        '    size 1 1 2',  // D=2 rows expected per layer
        '    layer 0',
        '    0',           // 1st row (need 2)
        '    socket s 0 0 0',  // socket closes active layer prematurely
        '    0',           // would have been 2nd row but layer is closed
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E10');
    });

    it('row continuation on subsequent line (v0.2 §7.9 multi-row token)', () => {
      // `0 0` on a line after `layer N` is treated as two row tokens
      // belonging to the active layer.
      const text = [
        'palette #FF0000',
        'part head',
        '    size 1 1 2',
        '    layer 0',
        '    0 0',  // 2 row tokens on the same subsequent line
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.voxels[0]).toHaveLength(2);
    });

    it('E03: bare `part` (no identifier) yields a clear E03', () => {
      const text = ['palette #FF0000', 'part'].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E03');
    });

    it('E17: bare `size` (no args) yields E17', () => {
      const text = ['palette #FF0000', 'part box', 'size'].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E17');
    });

    it('E04: unknown keyword when no active layer is open', () => {
      // After `pivot` (a known keyword), the active layer is flushed.
      // `wibble` then has no active layer to continue → E04.
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 1',
        '    layer 0  0',
        '    pivot 0 0 0',  // closes active layer
        '    wibble 1 2 3',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E04');
    });

    it('E04: unknown keyword with non-row-shape token even with active layer', () => {
      // `bogus #FF` — `#FF` is not a voxel-row token (contains `#`),
      // so the line is not row continuation; first token unknown → E04.
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 2',
        '    layer 0',
        '    0',
        '    bogus #FF',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E04');
    });
  });
});
