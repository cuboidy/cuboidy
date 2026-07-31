import { describe, expect, it } from 'vitest';
import { buildFsTree, dirsOf, type DirNode } from '../src/lib/fs-tree.js';

// A package is a flat map of /-separated paths (SPEC §3) — there is no
// on-disk directory entry to read — so the Files panel's tree is derived
// from that path set on every render. These pin the derivation.

const names = (n: DirNode) => n.files.map((f) => f.name);
const at = (n: DirNode, ...segs: string[]): DirNode => {
  let cur = n;
  for (const s of segs) {
    const child = cur.dirs.get(s);
    if (child === undefined) throw new Error(`no dir ${s}`);
    cur = child;
  }
  return cur;
};

describe('buildFsTree', () => {
  it('nests files under the directories their paths imply', () => {
    const t = buildFsTree([
      'cuboidy.json',
      'gear/hat.json',
      'gear/inner/bolt.json',
    ]);
    expect(names(t)).toEqual(['cuboidy.json']);
    expect(names(at(t, 'gear'))).toEqual(['hat.json']);
    expect(names(at(t, 'gear', 'inner'))).toEqual(['bolt.json']);
  });

  it('sorts siblings, so a rendered diff means something', () => {
    const t = buildFsTree(['z.json', 'a.json', 'm/b.json', 'm/a.json']);
    expect(names(t)).toEqual(['a.json', 'z.json']);
    expect(names(at(t, 'm'))).toEqual(['a.json', 'b.json']);
    expect(buildFsTree(['b/x.json', 'a/x.json'])).toEqual(
      buildFsTree(['a/x.json', 'b/x.json']),
    );
  });

  it('keeps a draft folder visible even with no file in it', () => {
    // A folder the user just created has no representation in the package
    // until something lands in it, so the panel carries it separately.
    const t = buildFsTree(['voxels.json'], ['anims']);
    expect(t.dirs.has('anims')).toBe(true);
    expect(names(at(t, 'anims'))).toEqual([]);
  });

  it('merges a draft folder with a real one of the same path', () => {
    const t = buildFsTree(['anims/walk.json'], ['anims']);
    expect(t.dirs.size).toBe(1);
    expect(names(at(t, 'anims'))).toEqual(['walk.json']);
  });

  it('is empty for an empty package', () => {
    const t = buildFsTree([]);
    expect(t.dirs.size).toBe(0);
    expect(t.files).toEqual([]);
  });
});

describe('dirsOf', () => {
  it('returns every ancestor directory of each path', () => {
    expect([...dirsOf(['gear/inner/bolt.json', 'voxels.json'])].sort()).toEqual([
      'gear',
      'gear/inner',
    ]);
  });

  it('counts the path itself when it names a directory', () => {
    expect([...dirsOf(['gear/inner'], true)].sort()).toEqual([
      'gear',
      'gear/inner',
    ]);
  });
});
