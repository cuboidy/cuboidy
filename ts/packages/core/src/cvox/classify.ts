export type CvoxLine =
  | { kind: 'blank' }
  | { kind: 'keyword'; keyword: string; args: string[] }
  | { kind: 'voxel-row'; text: string }
  | { kind: 'error'; code: CvoxLineErrorCode; message: string };

export type CvoxLineErrorCode = 'E04' | 'E07';

const KNOWN_KEYWORDS = new Set([
  'palette',
  'part',
  'size',
  'pivot',
  'socket',
  'layer',
]);

const VOXEL_ROW_RE = /^[.0-9a-zA-Z]+$/;

import { stripComment } from './comment.js';

export function classifyLine(raw: string): CvoxLine {
  const trimmed = stripComment(raw).trim();
  if (trimmed === '') return { kind: 'blank' };

  if (/\s/.test(trimmed)) {
    const tokens = trimmed.split(/\s+/);
    const keyword = tokens[0]!;
    const args = tokens.slice(1);
    if (!KNOWN_KEYWORDS.has(keyword)) {
      return {
        kind: 'error',
        code: 'E04',
        message: `unknown keyword '${keyword}'`,
      };
    }
    return { kind: 'keyword', keyword, args };
  }

  if (VOXEL_ROW_RE.test(trimmed)) {
    return { kind: 'voxel-row', text: trimmed };
  }

  return {
    kind: 'error',
    code: 'E07',
    message: `voxel row contains character outside [.0-9a-zA-Z]`,
  };
}
