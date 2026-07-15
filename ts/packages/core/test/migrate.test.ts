import { describe, expect, it } from 'vitest';
import { expandProjectReuse } from '../src/migrate.js';
import { parseCvox } from '../src/cvox/parse.js';
import type { Color } from '../src/cvox/types.js';
import type { Manifest } from '../src/manifest.js';

const RED: Color = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: Color = { r: 0, g: 0, b: 255, a: 255 };

describe('expandProjectReuse', () => {
  it('materializes a cross-file mirror under a bound palette (no remap)', () => {
    // Bound palette → the .cvox files declare none; indices are shared, so
    // the expanded part keeps them verbatim. arm-l lives in body.cvox;
    // arm-r mirrors it cross-file from limbs.cvox.
    const manifest: Manifest = {
      name: 'm',
      geometry: ['body.cvox', 'limbs.cvox'],
      palette: 'pal.json',
      parts: [],
    };
    const files = new Map<string, string>([
      ['body.cvox', 'part arm-l\n    size 2 1 1\n    voxels {\n        01\n    }\n'],
      ['limbs.cvox', 'part arm-r mirror arm-l\n'],
      ['pal.json', '{"colors":["#FF0000","#0000FF"]}\n'],
    ]);

    const result = expandProjectReuse(manifest, files);
    expect(result.complete).toBe(true);
    // Only limbs.cvox held a reuse part.
    expect([...result.files.keys()]).toEqual(['limbs.cvox']);

    const text = result.files.get('limbs.cvox')!;
    expect(text).not.toMatch(/\b(clone|mirror)\b/);
    const r = parseCvox(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const armR = r.value.parts.find((p) => p.name === 'arm-r')!;
    expect(armR.from).toBeUndefined();
    // x-mirror of row [0,1] is [1,0]; indices unchanged (shared palette).
    expect(armR.voxels[0]![0]).toEqual([1, 0]);
  });

  it('remaps indices into the declaring palette for a cross-file inline mirror', () => {
    // No bound palette: each file has its own inline palette. `dst` mirrors
    // `src` (in a.cvox), so its RED/BLUE indices must be brought into
    // b.cvox's palette, which starts with only GREEN.
    const manifest: Manifest = {
      name: 'm',
      geometry: ['a.cvox', 'b.cvox'],
      parts: [],
    };
    const files = new Map<string, string>([
      [
        'a.cvox',
        'palette #FF0000 #0000FF\n\npart src\n    size 2 1 1\n    voxels {\n        01\n    }\n',
      ],
      ['b.cvox', 'palette #00FF00\n\npart dst mirror src\n'],
    ]);

    const result = expandProjectReuse(manifest, files);
    expect(result.complete).toBe(true);
    expect([...result.files.keys()]).toEqual(['b.cvox']);

    const r = parseCvox(result.files.get('b.cvox')!);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dst = r.value.parts.find((p) => p.name === 'dst')!;
    expect(dst.from).toBeUndefined();
    // src row [0,1] = [RED,BLUE]; x-mirror → [BLUE,RED]. After remap into
    // b.cvox the indices resolve to those same colors.
    const [c0, c1] = dst.voxels[0]![0]!;
    expect(r.value.palette[c0!]).toEqual(BLUE);
    expect(r.value.palette[c1!]).toEqual(RED);
  });

  it('leaves a reuse-free model untouched', () => {
    const manifest: Manifest = { name: 'm', geometry: ['a.cvox'], parts: [] };
    const files = new Map<string, string>([
      ['a.cvox', 'palette #FF0000\n\npart p\n    size 1 1 1\n    voxels {\n        0\n    }\n'],
    ]);
    const result = expandProjectReuse(manifest, files);
    expect(result.complete).toBe(true);
    expect(result.files.size).toBe(0);
  });
});
