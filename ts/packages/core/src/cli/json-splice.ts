// Editing one value inside a hand-formatted JSON file without reformatting
// the rest of it.
//
// The model manifests in this repository are written by hand and read by
// hand: one part per line, blank lines grouping a rig into limbs. A
// parse/stringify round trip destroys that -- one manifest goes from 1870
// bytes to 3452 and every line of it turns up in the diff -- so a tool that
// edits a single number has to leave every byte it did not mean to touch.
//
// This is deliberately not a JSON parser. It scans for structure, skipping
// over string literals so a brace or bracket inside a name cannot fool it,
// and hands back the SPAN of the thing asked for. The caller splices.

/** Where something sits in the source text: `[start, end)`. */
export type Span = readonly [number, number];

/**
 * Scan from `open` (the index of a `{` or `[`) to its matching close, and
 * return the index just past it. String literals are skipped whole, escapes
 * included, so punctuation inside a name is not counted as structure.
 */
export function matchBracket(text: string, open: number): number {
  const closeOf: Record<string, string> = { '{': '}', '[': ']' };
  const want = closeOf[text[open]!];
  if (want === undefined) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The span of the array that `"<key>"` maps to, searching only within
 * `[from, to)`. Returns the whole `[...]` including its brackets, or null
 * when the key is absent there.
 */
export function arrayValueSpan(
  text: string,
  key: string,
  from: number,
  to: number,
): Span | null {
  const needle = `"${key}"`;
  let at = from;
  for (;;) {
    at = text.indexOf(needle, at);
    if (at < 0 || at >= to) return null;
    // Must be a KEY, so the next non-space character is a colon. Skips a
    // match that is really a string value elsewhere in the object.
    let j = at + needle.length;
    while (j < to && /\s/.test(text[j]!)) j++;
    if (text[j] !== ':') {
      at += needle.length;
      continue;
    }
    j++;
    while (j < to && /\s/.test(text[j]!)) j++;
    if (text[j] !== '[') return null;
    const end = matchBracket(text, j);
    return end < 0 ? null : [j, end];
  }
}

/**
 * The span of the object in the `parts` array whose `name` is `part`.
 *
 * Only the manifest's TOP-LEVEL `parts` array: a geometry file has one too,
 * and the two are different shapes, so a caller must pass the right file.
 */
export function partObjectSpan(text: string, part: string): Span | null {
  const partsAt = text.indexOf('"parts"');
  if (partsAt < 0) return null;
  let i = text.indexOf('[', partsAt);
  if (i < 0) return null;
  const arrayEnd = matchBracket(text, i);
  if (arrayEnd < 0) return null;
  i++;
  while (i < arrayEnd) {
    if (text[i] !== '{') {
      i++;
      continue;
    }
    const end = matchBracket(text, i);
    if (end < 0) return null;
    const nameSpan = stringValue(text, 'name', i, end);
    if (nameSpan === part) return [i, end];
    i = end;
  }
  return null;
}

/** The string `"<key>"` maps to within `[from, to)`, or null. */
export function stringValue(
  text: string,
  key: string,
  from: number,
  to: number,
): string | null {
  const needle = `"${key}"`;
  const at = text.indexOf(needle, from);
  if (at < 0 || at >= to) return null;
  let j = at + needle.length;
  while (j < to && /\s/.test(text[j]!)) j++;
  if (text[j] !== ':') return null;
  j++;
  while (j < to && /\s/.test(text[j]!)) j++;
  if (text[j] !== '"') return null;
  const end = text.indexOf('"', j + 1);
  return end < 0 ? null : text.slice(j + 1, end);
}

/**
 * Print a number the way the manifests do: as short as it can be written
 * without losing the value, and never in exponent form, which the schema
 * accepts and a reader does not want to meet in a coordinate.
 */
export function num(n: number): string {
  const r = Math.abs(n) < 1e-9 ? 0 : n;
  if (Number.isInteger(r)) return String(r);
  for (let p = 1; p <= 6; p++) {
    const s = r.toFixed(p);
    if (Number.parseFloat(s) === r) return s;
  }
  return r.toFixed(6);
}

/** `[a, b, c]` in the manifests' spacing. */
export function vec3(v: readonly [number, number, number]): string {
  return `[${v.map(num).join(', ')}]`;
}
