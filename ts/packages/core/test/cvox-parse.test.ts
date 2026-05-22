import { describe, expect, it } from 'vitest';
import { parseCvox } from '../src/cvox/parse.js';
import { readFixtureText } from './helpers/fixtures.js';

describe('parseCvox (v0.3 voxels block grammar)', () => {
  describe('positive', () => {
    it('parses wolf/voxels.cvox', async () => {
      const text = await readFixtureText('wolf/voxels.cvox');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.palette).toHaveLength(3);
      expect(r.value.parts).toHaveLength(7);
      expect(r.value.parts.map((p) => p.name)).toEqual([
        'body',
        'head',
        'tail',
        'leg-fl',
        'leg-fr',
        'leg-bl',
        'leg-br',
      ]);

      const head = r.value.parts.find((p) => p.name === 'head')!;
      expect(head.size).toEqual({ w: 5, h: 5, d: 5 });
      expect(head.pivot.pos).toEqual({ x: 2, y: 0, z: 5 });
      expect(head.sockets).toHaveLength(2);
      expect(head.sockets.map((s) => s.name)).toEqual(['hat', 'mouth']);
      expect(head.voxels).toHaveLength(5);
      // Eye row: layer y=2 (eye level), z=2 (front of main head, just behind
      // snout). `20002` → eyes (palette index 2) at the outer corners.
      expect(head.voxels[2]?.[2]).toEqual([2, 0, 0, 0, 2]);
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
        'voxels {',
        '0000',
        '0000',
        '0000',
        '0000',
        '0000',
        '0000',
        '}',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.pivot.pos).toEqual({ x: 2, y: 0, z: 3 });
    });

    it('parses positional layer indices (no layer keyword)', () => {
      const text = [
        'palette #FF0000 #00FF00',
        'part stack',
        'size 1 3 1',
        'voxels {',
        '0',
        ',',
        '1',
        ',',
        '0',
        '}',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        // voxels[y][z][x]
        expect(r.value.parts[0]?.voxels[0]?.[0]?.[0]).toBe(0);
        expect(r.value.parts[0]?.voxels[1]?.[0]?.[0]).toBe(1);
        expect(r.value.parts[0]?.voxels[2]?.[0]?.[0]).toBe(0);
      }
    });
  });

  describe('missing', () => {
    it('rejects missing palette', () => {
      const text = 'part head\nsize 1 1 1\nvoxels { 0 }';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects file with palette but no parts', () => {
      const r = parseCvox('palette #FF0000');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects part missing size', () => {
      const text = 'palette #FF0000\npart head\nvoxels { 0 }';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects part missing voxels', () => {
      const text = 'palette #FF0000\npart head\nsize 1 1 1';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects unclosed voxels block', () => {
      const text = 'palette #FF0000\npart head\nsize 1 1 1\nvoxels { 0';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects metadata keyword before any part', () => {
      const text = 'palette #FF0000\nsize 1 1 1';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects rot outside pivot/socket', () => {
      const text = 'palette #FF0000\nrot 0 0 0';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });
  });

  describe('duplicate', () => {
    it('rejects duplicate palette declaration', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 1 1 1',
        'voxels { 0 }',
        'palette #00FF00',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('duplicate');
    });

    it('rejects duplicate part name', () => {
      const text = [
        'palette #FF0000',
        'part a', 'size 1 1 1', 'voxels { 0 }',
        'part a', 'size 1 1 1', 'voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('duplicate');
    });

    it('rejects duplicate socket name within a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'socket s 0 0 0',
        'socket s 0 0 0',
        'voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('duplicate');
    });

    it('rejects duplicate size in a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'size 2 2 2',
        'voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('duplicate');
    });

    it('rejects duplicate pivot in a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'pivot 0 0 0',
        'pivot 0 0 0',
        'voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('duplicate');
    });

    it('rejects duplicate voxels block in a part', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'voxels { 0 }',
        'voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('duplicate');
    });
  });

  describe('wrong-arity', () => {
    it('rejects bare `part` (no identifier)', () => {
      const r = parseCvox('palette #FF0000\npart');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects bare `size` (no args)', () => {
      const r = parseCvox('palette #FF0000\npart box\nsize');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects voxels block missing opening `{`', () => {
      const text = 'palette #FF0000\npart box\nsize 1 1 1\nvoxels 0';
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects layer-section count mismatch (too few)', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 3 1',
        'voxels { 0 , 0 }', // 2 sections, expected H=3
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects layer-section count mismatch (too many)', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 1 1 1',
        'voxels { 0 , 0 }', // 2 sections, expected H=1
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects row count in a section ≠ D (too few)', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 3 1 4',
        'voxels { 000 000 000 }', // 3 rows, expected D=4
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects row count in a section ≠ D (too many)', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 3 2 2',
        'voxels { 000 000 000 , 000 000 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('rejects voxel row width ≠ W', () => {
      const text = [
        'palette #FF0000',
        'part head',
        'size 3 1 3',
        'voxels { 0000 000 000 }', // first row width 4 ≠ W=3
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });
  });

  describe('invalid-value', () => {
    it('rejects voxel cell outside [.0-9a-zA-Z]', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 3 1 1',
        'voxels { 00! }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    });

    it('rejects palette index out of range', () => {
      const text = [
        'palette #FF0000', // 1 color
        'part box',
        'size 3 1 1',
        'voxels { 012 }', // index 1 and 2 are out of range
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    });

    it('rejects nested `{` inside voxels block', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 1 1 1',
        'voxels { { 0 } }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    });
  });

  describe('unknown', () => {
    it('rejects unknown identifier at top level', () => {
      const r = parseCvox('mystery 1 2 3');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('unknown');
    });
  });

  describe('missing (reserved token outside valid scope)', () => {
    it('rejects stray `,` at top level', () => {
      const r = parseCvox(',');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects stray `{` at top level', () => {
      const r = parseCvox('{ 0 }');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });

    it('rejects stray `}` at top level', () => {
      const r = parseCvox('}');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('missing');
    });
  });

  describe('lexical isolation inside voxels block', () => {
    it('reserved words (rot, size, part) are valid voxel-row strings inside voxels', () => {
      // palette must have >=30 colors for `rot`: r=27, o=24, t=29
      const palette = [
        '#000', '#001', '#002', '#003', '#004', '#005', '#006', '#007', '#008', '#009',
        '#00a', '#00b', '#00c', '#00d', '#00e', '#00f', '#010', '#011', '#012', '#013',
        '#014', '#015', '#016', '#017', '#018', '#019', '#01a', '#01b', '#01c', '#01d',
      ].join(' ');
      const text = [
        `palette ${palette}`,
        'part demo',
        'size 3 1 1',
        'voxels { rot }', // rot as voxel row → indices [27, 24, 29]
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.voxels[0]?.[0]).toEqual([27, 24, 29]);
    });

    it('voxel-row text "size" parses as voxel data with 30+ color palette', () => {
      const palette = Array.from({ length: 36 }, (_, i) => `#${i.toString(16).padStart(3, '0')}`).join(' ');
      const text = [
        `palette ${palette}`,
        'part demo',
        'size 4 1 1',
        'voxels { size }', // s=28, i=18, z=35, e=14
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.voxels[0]?.[0]).toEqual([28, 18, 35, 14]);
    });
  });

  describe('whitespace and comments', () => {
    it('parses voxels block on a single line', () => {
      const text = 'palette #FF0000\npart box\nsize 3 1 3\nvoxels { 000 000 000 }';
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.voxels[0]).toHaveLength(3);
    });

    it('parses voxels with commas adjacent to rows (no whitespace required)', () => {
      const text = 'palette #FF0000\npart box\nsize 1 2 1\nvoxels{0,0}';
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.voxels).toHaveLength(2);
    });

    it('parses comments inside voxels block', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size 1 2 1',
        'voxels {',
        '  // layer 0',
        '  0',
        '  ,',
        '  // layer 1',
        '  0',
        '}',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
    });

    it('parses with full-line and trailing comments', () => {
      const text = [
        '// the box model',
        'palette #FF0000  // red',
        '',
        'part box  // the box',
        '    size 1 1 1',
        '    voxels { 0 }  // filled',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
    });

    it('size args can span multiple lines', () => {
      const text = [
        'palette #FF0000',
        'part box',
        'size',
        '3',
        '1',
        '3',
        'voxels { 000 000 000 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.parts[0]?.size).toEqual({ w: 3, h: 1, d: 3 });
    });

    it('palette colors can be split across lines', () => {
      const text = [
        'palette',
        '    #FF0000',
        '    #00FF00',
        '    #0000FF',
        'part box',
        '    size 1 1 1',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.palette).toHaveLength(3);
    });
  });

  describe('free-order within scope', () => {
    it('parses palette declared after parts', () => {
      const text = [
        'part box',
        '    size 1 1 1',
        '    voxels { 0 }',
        '',
        'palette #FF0000',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.palette).toHaveLength(1);
    });

    it('parses metadata in any order (pivot before size, voxels before size)', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '    pivot 1 0 1',
        '    socket s 0 0 0',
        '    voxels { 0 }',
        '    size 1 1 1',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.parts[0]?.pivot.pos).toEqual({ x: 1, y: 0, z: 1 });
        expect(r.value.parts[0]?.sockets).toHaveLength(1);
      }
    });

    it('palette mid-part does not close the part', () => {
      const text = [
        'part box',
        '    size 1 1 1',
        '    palette #FF0000',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.parts).toHaveLength(1);
        expect(r.value.parts[0]?.name).toBe('box');
        expect(r.value.parts[0]?.voxels).toEqual([[[0]]]);
      }
    });
  });

  describe('pivot/socket with rot', () => {
    it('pivot with rot (7 args) parses and persists rotation', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 1',
        '    pivot 0 0 0 rot 0 90 0',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const p = r.value.parts[0]!.pivot;
        expect(p.pos).toEqual({ x: 0, y: 0, z: 0 });
        expect(p.rot).toEqual({ x: 0, y: 90, z: 0 });
      }
    });

    it('pivot 3-args (no rot) still works', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 1',
        '    pivot 0 0 0',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const p = r.value.parts[0]!.pivot;
        expect(p.pos).toEqual({ x: 0, y: 0, z: 0 });
        expect(p.rot).toBeUndefined();
      }
    });

    it('socket with rot (8 args) persists rotation', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 1',
        '    socket hat 0 0 0 rot 0 90 0',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const s = r.value.parts[0]?.sockets[0];
        expect(s?.name).toBe('hat');
        expect(s?.rot).toEqual({ x: 0, y: 90, z: 0 });
      }
    });

    it('socket args (with rot) can span multiple lines', () => {
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 1',
        '    socket',
        '        hat',
        '        0',
        '        0',
        '        0',
        '        rot',
        '        0',
        '        90',
        '        0',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const s = r.value.parts[0]?.sockets[0];
        expect(s?.name).toBe('hat');
        expect(s?.rot).toEqual({ x: 0, y: 90, z: 0 });
      }
    });

    it('pivot extra numeric arg surfaces as unknown under integrated parsing', () => {
      // Token-stream model: extras beyond 3 (or 7-with-rot) args are not stolen
      // by pivot. They fall through to the main loop. With no active voxels
      // context, a stray `5` is an unknown top-level token.
      const text = [
        'palette #FF0000',
        'part box',
        '    size 1 1 1',
        '    pivot 1 0 1 5',
        '    voxels { 0 }',
      ].join('\n');
      const r = parseCvox(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('unknown');
    });
  });
});
