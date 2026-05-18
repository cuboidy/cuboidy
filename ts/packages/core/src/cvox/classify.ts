import { stripComment } from './comment.js';

export type CvoxLine =
  | { kind: 'blank' }
  | { kind: 'keyword'; keyword: string; args: string[] }
  | { kind: 'voxel-row'; text: string }
  | { kind: 'error'; code: CvoxLineErrorCode; message: string };

export type CvoxLineErrorCode = 'invalid-value';

export const KNOWN_KEYWORDS: ReadonlySet<string> = new Set([
  'palette',
  'part',
  'size',
  'pivot',
  'socket',
  'layer',
]);

export const VOXEL_ROW_RE = /^[.0-9a-zA-Z]+$/;

export function classifyLine(raw: string): CvoxLine {
  const trimmed = stripComment(raw).trim();
  if (trimmed === '') return { kind: 'blank' };

  if (/\s/.test(trimmed)) {
    const tokens = trimmed.split(/\s+/);
    return { kind: 'keyword', keyword: tokens[0]!, args: tokens.slice(1) };
  }

  // Single-token line: bare keyword (no args) takes precedence over voxel-row
  // so that `part` alone yields a clear E03 from the part handler rather than
  // a confusing E10/E11 from being parsed as a voxel row.
  if (KNOWN_KEYWORDS.has(trimmed)) {
    return { kind: 'keyword', keyword: trimmed, args: [] };
  }

  if (VOXEL_ROW_RE.test(trimmed)) {
    return { kind: 'voxel-row', text: trimmed };
  }

  return {
    kind: 'error',
    code: 'invalid-value',
    message: `voxel row contains character outside [.0-9a-zA-Z]`,
  };
}
