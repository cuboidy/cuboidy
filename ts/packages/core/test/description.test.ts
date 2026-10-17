import { describe, expect, it } from 'vitest';
import { DESCRIPTION_MAX, parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';
import { RIGGED } from './helpers/corpus.js';

// SPEC §6.15: one line of plain text in which a model says what it is and
// what it looks like. The rules are the reader's, not lint's, so every case
// here is a parse.

const base = { name: 'm', parts: [{ name: 'body' }] };
const describing = (description: unknown) => ({ ...base, description });

function codeOf(json: unknown): string {
  const r = parseManifest(json);
  return r.ok ? 'ok' : r.code;
}

// One code point, two UTF-16 units.
const FOX = '\u{1F98A}';

describe('description (§6.15)', () => {
  it('is absent from a manifest that writes none, and nothing stands in for it', async () => {
    const r = parseManifest(await readFixtureJson(`${RIGGED}/cuboidy.json`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.value, 'description')).toBe(false);
  });

  it('reads back exactly as written, in whatever language it is written in', () => {
    for (const text of [
      'A knight in grey steel plate, with a red tabard trimmed in gold and a closed helm.',
      // Japanese, "a bird-shaped weathervane".
      '\u9ce5\u306e\u5f62\u306e\u98a8\u898b',
      `A fox ${FOX} with a white-tipped tail`,
      // Not normalized: the decomposed and the composed spelling both survive.
      'cafe\u0301 or caf\u00e9',
      "  spaces at either end are the author's  ",
    ]) {
      const r = parseManifest(describing(text));
      expect(r.ok, text).toBe(true);
      if (r.ok) expect(r.value.description).toBe(text);
    }
  });

  it('changes nothing else the manifest says', async () => {
    const json = (await readFixtureJson(`${RIGGED}/cuboidy.json`)) as Record<string, unknown>;
    const without = parseManifest(json);
    const described = parseManifest({ ...json, description: 'A small rig.' });
    expect(without.ok).toBe(true);
    expect(described.ok).toBe(true);
    if (!without.ok || !described.ok) return;
    const { description, ...rest } = described.value;
    expect(description).toBe('A small rig.');
    expect(rest).toEqual(without.value);
  });

  it(`is at most ${DESCRIPTION_MAX} code points, counted in code points and not UTF-16 units`, () => {
    expect(DESCRIPTION_MAX).toBe(200);
    expect(codeOf(describing('a'.repeat(200)))).toBe('ok');
    expect(codeOf(describing(FOX.repeat(200)))).toBe('ok'); // 400 units
    expect(codeOf(describing('a'.repeat(201)))).toBe('wrong-arity');
    expect(codeOf(describing(FOX.repeat(201)))).toBe('wrong-arity');
  });

  it('is counted as written: a combining mark is a code point of its own', () => {
    // `e` + U+0301 is one character to a reader that composes (NFC) or counts
    // graphemes, and two code points to this one.
    expect(codeOf(describing('a'.repeat(198) + 'e\u0301'))).toBe('ok');
    expect(codeOf(describing('a'.repeat(199) + 'e\u0301'))).toBe('wrong-arity');
  });

  it('says how long it is when it is too long', () => {
    const r = parseManifest(describing('a'.repeat(250)));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toBe(
      'description: a description is at most 200 code points, and this one is 250',
    );
    expect(r.path).toEqual(['description']);
  });

  it('is not empty: an author with nothing to say leaves the field out', () => {
    expect(codeOf(describing(''))).toBe('wrong-arity');
  });

  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['tab', '\t'],
    ['U+0000', '\u0000'],
    ['U+001F', '\u001F'],
    ['DEL', '\u007F'],
    ['NEL', '\u0085'],
    ['U+009F', '\u009F'],
    ['LINE SEPARATOR', '\u2028'],
    ['PARAGRAPH SEPARATOR', '\u2029'],
  ])('is one line: %s in it is invalid-value', (_name, ch) => {
    expect(codeOf(describing(`A crate${ch}with a lid`))).toBe('invalid-value');
  });

  it('names the character that breaks the line', () => {
    const r = parseManifest(describing('A crate.\nIt is empty.'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toBe(
      'description: a description is one line, and U+000A is a line break or a control character',
    );
  });

  it('allows the characters either side of each excluded range', () => {
    for (const ch of [' ', '~', '\u00A0', '\u2027', '\u202A']) {
      expect(codeOf(describing(`A crate${ch}with a lid`)), ch.codePointAt(0)!.toString(16)).toBe('ok');
    }
  });

  it('is text: half of a surrogate pair is invalid-value', () => {
    for (const text of ['\uD800', 'a\uDC00b', 'a fox \uD83D', '\uDE00\uD83D']) {
      expect(codeOf(describing(text)), JSON.stringify(text)).toBe('invalid-value');
    }
  });

  it('is a string', () => {
    for (const value of [3, null, true, ['a'], { text: 'a' }]) {
      expect(codeOf(describing(value)), JSON.stringify(value)).toBe('invalid-value');
    }
  });

  it("is the model's: a part carries none", () => {
    expect(codeOf({ name: 'm', parts: [{ name: 'body', description: 'A box.' }] })).toBe('unknown');
  });
});
