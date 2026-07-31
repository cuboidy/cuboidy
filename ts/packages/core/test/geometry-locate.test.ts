import { describe, expect, it } from 'vitest';
import { locateJsonPath, positionAt } from '../src/geometry/locate.js';
import { parseGeometryText } from '../src/geometry/parse.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Document path → source position. The retired text format reported `line N:`
// on every error; these tests hold the JSON reader to the same standard.

const DOC = `{
  "version": "0.9",
  "palette": ["#4A5568", "#F6E05E"],
  "parts": [
    {
      "name": "body",
      "size": [2, 2, 1],
      "voxels": [
        ["00"],
        ["01"]
      ]
    },
    {
      "name": "head",
      "size": [2, 1, 1],
      "pivot": { "pos": [1, 0, 0], "rot": [0, 0, 45] },
      "voxels": [["11"]]
    }
  ]
}
`;

// The line each construct sits on, read off DOC above.
const lineOf = (needle: string): number =>
  DOC.slice(0, DOC.indexOf(needle)).split('\n').length;

describe('locateJsonPath', () => {
  it('resolves a top-level key', () => {
    expect(locateJsonPath(DOC, ['parts'])?.line).toBe(lineOf('"parts"'));
  });

  it('resolves an array element', () => {
    expect(locateJsonPath(DOC, ['parts', 1])?.line).toBe(lineOf('"head"') - 1);
  });

  it('resolves a nested key past a preceding array element', () => {
    // Reaching parts.1.size means skipping over parts.0 entirely, including
    // its own nested arrays.
    expect(locateJsonPath(DOC, ['parts', 1, 'size'])?.line).toBe(
      lineOf('"size": [2, 1, 1]'),
    );
  });

  it('resolves into a nested array of arrays', () => {
    expect(locateJsonPath(DOC, ['parts', 0, 'voxels', 1])?.line).toBe(
      lineOf('["01"]'),
    );
  });

  it('resolves a key inside an inline object', () => {
    const at = locateJsonPath(DOC, ['parts', 1, 'pivot', 'rot']);
    expect(at?.line).toBe(lineOf('"pivot"'));
    // Column points at the `[` of the rot triple, not at the pivot object.
    expect(DOC.split('\n')[at!.line - 1]!.slice(at!.column - 1)).toMatch(
      /^\[0, 0, 45\]/,
    );
  });

  it('falls back to the deepest existing ancestor when a key is absent', () => {
    // The `missing` case: point at the part, which is the useful location.
    expect(locateJsonPath(DOC, ['parts', 0, 'pivot', 'pos'])?.line).toBe(
      lineOf('"name": "body"') - 1,
    );
  });

  it('returns the container for an out-of-range index', () => {
    expect(locateJsonPath(DOC, ['parts', 9])?.line).toBe(lineOf('"parts"'));
  });

  it('is not confused by structural characters inside strings', () => {
    const tricky = '{"a": "}], \\" tricky", "b": [1, 2]}';
    const at = locateJsonPath(tricky, ['b']);
    expect(tricky.slice(at!.column - 1)).toBe('[1, 2]}');
  });

  it('handles CRLF text', () => {
    const at = locateJsonPath(DOC.replace(/\n/g, '\r\n'), ['parts', 1, 'size']);
    expect(at?.line).toBe(lineOf('"size": [2, 1, 1]'));
  });

  it('returns null for an empty document', () => {
    expect(locateJsonPath('   ', ['parts'])).toBeNull();
  });
});

describe('positionAt', () => {
  it('counts lines and columns from 1', () => {
    expect(positionAt('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    expect(positionAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });

  it('clamps out-of-range offsets', () => {
    expect(positionAt('ab', 99)).toEqual({ line: 1, column: 3 });
    expect(positionAt('ab', -5)).toEqual({ line: 1, column: 1 });
  });
});

describe('parseGeometryText line reporting', () => {
  it('prefixes a schema error with the line it is on', () => {
    const broken = DOC.replace('"size": [2, 1, 1],', '"size": [2, 9, 1],');
    const r = parseGeometryText(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // head declares H=9 but ships one layer; the report points at `voxels`.
    expect(r.message).toBe(
      `line ${lineOf('"voxels": [["11"]]')}: parts.1.voxels: 1 layers, expected H=9`,
    );
    expect(r.path).toEqual(['parts', 1, 'voxels']);
  });

  it('points a missing required field at its part', () => {
    const broken = DOC.replace('      "size": [2, 2, 1],\n', '');
    const r = parseGeometryText(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing');
    // Zod would say "expected tuple, received undefined"; a forgotten line
    // deserves plainer wording.
    expect(r.message).toBe('line 5: parts.0.size: required field is missing');
  });

  it('leaves a JSON syntax error to the engine message', () => {
    const r = parseGeometryText('{"parts": [');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/^invalid JSON:/);
  });

  it('reports a real line on a real multi-part file', () => {
    const path = resolve(
      import.meta.dirname,
      '../../../testdata/multifile/body.json',
    );
    const text = readFileSync(path, 'utf8');
    // Narrow one row: body.json references a shared palette rather than
    // declaring one inline, so width — not index range — is what it can fail on.
    const broken = text.replace('"0220"', '"022"');
    expect(broken).not.toBe(text);
    const r = parseGeometryText(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const line = broken.slice(0, broken.indexOf('"022"')).split('\n').length;
    expect(r.message).toBe(
      `line ${line}: parts.0.voxels.1.0: row length 3, expected W=4`,
    );
  });
});
