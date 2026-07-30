// Maps a document path — object keys and array indices from the root — back to
// a position in the source text.
//
// The retired `.cvox` reader reported `line N:` on every error because its
// tokenizer carried line numbers. A JSON reader gets its errors from the schema
// instead, which knows the path (`parts.2.size`) but nothing about bytes. This
// module closes that gap so an error can still say WHERE, which in a plain
// textarea with a line gutter is the only navigation the author has.
//
// The scanner is deliberately minimal: it only needs to find the offset a value
// begins at, so it skips over values rather than building them. It assumes the
// text already parsed as JSON — every caller has run `JSON.parse` first — which
// is why malformed input has no error path here; it simply stops and reports
// the deepest position it did reach.

export interface Position {
  // Both 1-based, matching how editors and the old geometry errors count.
  line: number;
  column: number;
}

// Resolves `path` to a position. When a segment does not exist — the usual case
// for a missing required field — the deepest ancestor that DOES exist is used,
// so `parts.2.size` on a part with no `size` points at that part.
export function locateJsonPath(
  text: string,
  path: ReadonlyArray<string | number>,
): Position | null {
  const offset = offsetAtPath(text, path);
  return offset === null ? null : positionAt(text, offset);
}

export function positionAt(text: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

function offsetAtPath(
  text: string,
  path: ReadonlyArray<string | number>,
): number | null {
  let at = skipWs(text, 0);
  if (at >= text.length) return null;
  for (const segment of path) {
    const child = childOffset(text, at, segment);
    // Absent segment: the deepest resolved ancestor is the best answer.
    if (child === null) return at;
    at = child;
  }
  return at;
}

// Offset of `segment` within the container starting at `start`, or null if the
// container is the wrong kind or the segment is not there.
function childOffset(
  text: string,
  start: number,
  segment: string | number,
): number | null {
  const open = text[start];
  if (typeof segment === 'number') {
    if (open !== '[') return null;
    let i = skipWs(text, start + 1);
    for (let index = 0; i < text.length && text[i] !== ']'; index++) {
      if (index === segment) return i;
      i = skipWs(text, skipValue(text, i));
      if (text[i] === ',') i = skipWs(text, i + 1);
    }
    return null;
  }

  if (open !== '{') return null;
  let i = skipWs(text, start + 1);
  while (i < text.length && text[i] !== '}') {
    if (text[i] !== '"') return null;
    const keyEnd = skipString(text, i);
    const key = readString(text, i, keyEnd);
    i = skipWs(text, keyEnd);
    if (text[i] !== ':') return null;
    i = skipWs(text, i + 1);
    if (key === segment) return i;
    i = skipWs(text, skipValue(text, i));
    if (text[i] === ',') i = skipWs(text, i + 1);
  }
  return null;
}

// ----- scanning primitives ----------------------------------------------

function skipWs(text: string, i: number): number {
  let at = i;
  while (at < text.length) {
    const c = text.charCodeAt(at);
    // space, tab, LF, CR — the only whitespace JSON allows.
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
    at++;
  }
  return at;
}

// Index just past the value starting at `i`.
function skipValue(text: string, i: number): number {
  const c = text[i];
  if (c === '"') return skipString(text, i);
  if (c === '{' || c === '[') return skipContainer(text, i);
  // Literal or number: runs until a structural character or whitespace.
  let at = i;
  while (at < text.length && !',]}: \t\n\r'.includes(text[at]!)) at++;
  return at;
}

function skipContainer(text: string, i: number): number {
  const close = text[i] === '{' ? '}' : ']';
  let at = skipWs(text, i + 1);
  while (at < text.length && text[at] !== close) {
    // Object keys are strings and `:` is skipped as a lone structural
    // character, so one loop handles both container kinds.
    if (text[at] === ':' || text[at] === ',') {
      at = skipWs(text, at + 1);
      continue;
    }
    at = skipWs(text, skipValue(text, at));
  }
  return at < text.length ? at + 1 : at;
}

// Index just past the closing quote of the string starting at `i`.
function skipString(text: string, i: number): number {
  let at = i + 1;
  while (at < text.length) {
    const c = text[at];
    if (c === '\\') {
      at += 2;
      continue;
    }
    if (c === '"') return at + 1;
    at++;
  }
  return at;
}

// The decoded value of the string token spanning [start, end).
function readString(text: string, start: number, end: number): string {
  const raw = text.slice(start, end);
  try {
    return JSON.parse(raw) as string;
  } catch {
    // Unreachable for text that already parsed; degrade to the raw slice
    // rather than throwing out of a diagnostic helper.
    return raw.slice(1, -1);
  }
}
