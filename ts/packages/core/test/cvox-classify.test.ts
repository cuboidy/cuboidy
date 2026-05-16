import { describe, expect, it } from 'vitest';
import { classifyLine } from '../src/cvox/classify.js';

describe('classifyLine', () => {
  describe('blank', () => {
    it('classifies empty line as blank', () => {
      expect(classifyLine('')).toEqual({ kind: 'blank' });
    });

    it('classifies whitespace-only line as blank', () => {
      expect(classifyLine('   ')).toEqual({ kind: 'blank' });
      expect(classifyLine('\t')).toEqual({ kind: 'blank' });
    });
  });

  describe('keyword', () => {
    it('classifies palette line', () => {
      expect(classifyLine('palette #8B4513 #000000')).toEqual({
        kind: 'keyword',
        keyword: 'palette',
        args: ['#8B4513', '#000000'],
      });
    });

    it('classifies part line', () => {
      expect(classifyLine('part head')).toEqual({
        kind: 'keyword',
        keyword: 'part',
        args: ['head'],
      });
    });

    it('classifies size line', () => {
      expect(classifyLine('size 3 3 3')).toEqual({
        kind: 'keyword',
        keyword: 'size',
        args: ['3', '3', '3'],
      });
    });

    it('classifies pivot line', () => {
      expect(classifyLine('pivot 1 0 1')).toEqual({
        kind: 'keyword',
        keyword: 'pivot',
        args: ['1', '0', '1'],
      });
    });

    it('classifies socket line', () => {
      expect(classifyLine('socket hat 1 3 1')).toEqual({
        kind: 'keyword',
        keyword: 'socket',
        args: ['hat', '1', '3', '1'],
      });
    });

    it('classifies socket with rotation', () => {
      expect(classifyLine('socket mouth 1 1 3 rot 0 90 0')).toEqual({
        kind: 'keyword',
        keyword: 'socket',
        args: ['mouth', '1', '1', '3', 'rot', '0', '90', '0'],
      });
    });

    it('classifies layer line', () => {
      expect(classifyLine('layer 0')).toEqual({
        kind: 'keyword',
        keyword: 'layer',
        args: ['0'],
      });
    });

    it('tolerates leading/trailing whitespace', () => {
      expect(classifyLine('  part head  ')).toEqual({
        kind: 'keyword',
        keyword: 'part',
        args: ['head'],
      });
    });

    it('collapses multiple spaces between args', () => {
      expect(classifyLine('size  3   3 3')).toEqual({
        kind: 'keyword',
        keyword: 'size',
        args: ['3', '3', '3'],
      });
    });
  });

  describe('voxel-row', () => {
    it('classifies digit row', () => {
      expect(classifyLine('000')).toEqual({ kind: 'voxel-row', text: '000' });
    });

    it('classifies mixed digit + dot row', () => {
      expect(classifyLine('0.0')).toEqual({ kind: 'voxel-row', text: '0.0' });
    });

    it('classifies row with letters', () => {
      expect(classifyLine('aZ9.')).toEqual({ kind: 'voxel-row', text: 'aZ9.' });
    });

    it('classifies single-char row', () => {
      expect(classifyLine('.')).toEqual({ kind: 'voxel-row', text: '.' });
      expect(classifyLine('0')).toEqual({ kind: 'voxel-row', text: '0' });
    });
  });

  describe('errors', () => {
    it('returns keyword line for unknown keyword (E04 raised later by parser)', () => {
      // v0.2: classify is permissive about keyword identity; the parser
      // decides whether an unknown keyword is row continuation (§7.9) or E04.
      expect(classifyLine('foo bar')).toEqual({
        kind: 'keyword',
        keyword: 'foo',
        args: ['bar'],
      });
    });

    it('E07: voxel row with invalid character (hyphen)', () => {
      const result = classifyLine('00-');
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('E07');
      }
    });

    it('E07: voxel row with non-ASCII character', () => {
      const result = classifyLine('00xあ');
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('E07');
      }
    });
  });

  describe('bare keyword lines (v0.2)', () => {
    it('classifies bare `part` as keyword with no args', () => {
      expect(classifyLine('part')).toEqual({
        kind: 'keyword',
        keyword: 'part',
        args: [],
      });
    });

    it('classifies bare `size` as keyword with no args', () => {
      expect(classifyLine('size')).toEqual({
        kind: 'keyword',
        keyword: 'size',
        args: [],
      });
    });

    it('classifies bare `palette` as keyword with no args', () => {
      expect(classifyLine('palette')).toEqual({
        kind: 'keyword',
        keyword: 'palette',
        args: [],
      });
    });

    it('classifies bare `layer` as keyword with no args', () => {
      expect(classifyLine('layer')).toEqual({
        kind: 'keyword',
        keyword: 'layer',
        args: [],
      });
    });

    it('a non-keyword single token is still a voxel row', () => {
      expect(classifyLine('foo')).toEqual({ kind: 'voxel-row', text: 'foo' });
    });
  });
});
