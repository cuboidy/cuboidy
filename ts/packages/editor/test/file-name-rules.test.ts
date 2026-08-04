import { describe, expect, it } from 'vitest';
import {
  extensionFitsKind,
  validateNewFolderName,
  validateNewPath,
  validateRenameFolderName,
  validateRenameName,
} from '../src/lib/file-name-rules.js';

// The Files tree's naming rules, pure and therefore pinnable directly.
// The interesting one is the KIND: since v0.9 every referenced file is
// `.json` (§8), so the name cannot say what a file is — the author does,
// and these rules only keep the two from contradicting each other.

const taken = (...paths: string[]): ReadonlySet<string> => new Set(paths);

describe('extensionFitsKind', () => {
  it('requires .json for the three model kinds (§8)', () => {
    for (const kind of ['geometry', 'palette', 'clip'] as const) {
      expect(extensionFitsKind('a.json', kind)).toBe(true);
      expect(extensionFitsKind('a.JSON', kind)).toBe(true);
      expect(extensionFitsKind('a.md', kind)).toBe(false);
      expect(extensionFitsKind('a.txt', kind)).toBe(false);
    }
  });

  it('requires .md / .txt for a plain note', () => {
    expect(extensionFitsKind('notes.md', 'text')).toBe(true);
    expect(extensionFitsKind('notes.txt', 'text')).toBe(true);
    expect(extensionFitsKind('notes.json', 'text')).toBe(false);
  });

  // The whole point: a palette and a geometry file are indistinguishable
  // by name, so neither name nor folder may decide the kind.
  it('accepts any .json NAME for any model kind', () => {
    expect(extensionFitsKind('colors.json', 'palette')).toBe(true);
    expect(extensionFitsKind('palette.json', 'geometry')).toBe(true);
    expect(extensionFitsKind('anims/walk.json', 'geometry')).toBe(true);
    expect(extensionFitsKind('gear/body.json', 'clip')).toBe(true);
  });
});

describe('validateNewPath', () => {
  it('rejects a name whose extension contradicts the chosen kind', () => {
    expect(validateNewPath('notes.md', taken(), 'palette')).toBe(false);
    expect(validateNewPath('colors.json', taken(), 'palette')).toBe(true);
    expect(validateNewPath('colors.json', taken(), 'text')).toBe(false);
  });

  it('ignores the kind when none is given (the rename path)', () => {
    expect(validateNewPath('notes.md', taken())).toBe(true);
    expect(validateNewPath('colors.json', taken())).toBe(true);
  });

  it('still rejects taken paths, bad segments and other extensions', () => {
    expect(validateNewPath('a.json', taken('a.json'), 'geometry')).toBe(false);
    expect(validateNewPath('../a.json', taken(), 'geometry')).toBe(false);
    expect(validateNewPath('a/./b.json', taken(), 'geometry')).toBe(false);
    expect(validateNewPath('a\\b.json', taken(), 'geometry')).toBe(false);
    expect(validateNewPath('a.png', taken(), 'text')).toBe(false);
  });
});

describe('validateNewFolderName', () => {
  const sets = {
    paths: taken('gear/body.json'),
    dirs: taken('gear'),
    drafts: taken('draft'),
  };

  it('accepts a free name and rejects one taken by a file, dir or draft', () => {
    expect(validateNewFolderName('', 'anims', sets)).toBe(true);
    expect(validateNewFolderName('', 'gear', sets)).toBe(false);
    expect(validateNewFolderName('', 'draft', sets)).toBe(false);
    expect(validateNewFolderName('gear', 'body.json', sets)).toBe(false);
  });

  it('rejects path-traversal and empty segments', () => {
    expect(validateNewFolderName('', '..', sets)).toBe(false);
    expect(validateNewFolderName('', 'a//b', sets)).toBe(false);
  });
});

describe('validateRenameName', () => {
  it('keeps a file .json — every reference is (§8)', () => {
    expect(validateRenameName('body.json', 'torso.json', taken())).toBe(true);
    expect(validateRenameName('body.json', 'torso.md', taken())).toBe(false);
    // A note is free to change between the text extensions.
    expect(validateRenameName('notes.md', 'notes.txt', taken())).toBe(true);
  });

  it('is a no-op for the unchanged name, and refuses to move folders', () => {
    expect(validateRenameName('gear/body.json', 'body.json', taken())).toBe(true);
    expect(validateRenameName('body.json', 'gear/body.json', taken())).toBe(false);
  });

  it('checks the new path against the folder it lands in', () => {
    expect(
      validateRenameName('gear/body.json', 'arm.json', taken('gear/arm.json')),
    ).toBe(false);
    expect(
      validateRenameName('gear/body.json', 'arm.json', taken('arm.json')),
    ).toBe(true);
  });
});

describe('validateRenameFolderName', () => {
  const sets = { paths: taken('gear/body.json'), dirs: taken('gear', 'anims') };

  it('renames within the same parent and refuses a taken sibling', () => {
    expect(validateRenameFolderName('gear', 'armour', sets)).toBe(true);
    expect(validateRenameFolderName('gear', 'anims', sets)).toBe(false);
    expect(validateRenameFolderName('gear', 'a/b', sets)).toBe(false);
  });
});
