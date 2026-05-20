import { parseCvox, type Cvox } from '@cuboidy/core';

// Result of attempting to load a cvox file into the editor. The editor
// surface treats parse errors and successful loads with diagnostic
// messages uniformly: every load yields a LoadResult so the UI doesn't
// need a separate error path. `cvox` is undefined iff parsing failed.

export interface LoadResult {
  fileName: string;
  cvox?: Cvox;
  error?: string;
  // Count of `//` comment occurrences that were dropped because they're
  // not in the file header (SPEC §7.11 advisory rule, v0.6 policy).
  // Surfaced as a UI warning so users understand the editor doesn't
  // round-trip them; only the header (§7.11.1) survives save.
  droppedInlineComments: number;
}

export function loadModel(text: string, fileName: string): LoadResult {
  const droppedInlineComments = countInlineComments(text);
  const r = parseCvox(text);
  if (!r.ok) {
    return { fileName, error: r.message, droppedInlineComments };
  }
  return { fileName, cvox: r.value, droppedInlineComments };
}

// Counts inline `//` comments — every `//` occurrence that is NOT part
// of the file header. Header `//` lines are subtracted so the count
// reflects only the comments that will be lost on round-trip.
//
// A robust count would tokenize and distinguish `//` inside string
// literals, but cvox has no `"..."` slot where `//` could appear as
// payload (string-kind tokens exist at the lexer level but no v0.6
// production accepts them), so a naive line-by-line scan is exact.
function countInlineComments(text: string): number {
  const lines = text.split(/\r?\n/);
  let inHeader = true;
  let inlineCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inHeader) {
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith('//')) continue;
      inHeader = false;
    }
    if (line.includes('//')) inlineCount++;
  }
  return inlineCount;
}
