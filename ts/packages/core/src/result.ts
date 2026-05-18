export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: CuboidyErrorCode; message: string };

// Structural error taxonomy (SPEC §11). Per-keyword codes are intentionally
// avoided; the keyword/context lives in the message string.
export type CuboidyErrorCode =
  // A required structural element is absent (e.g. missing `size` in a part,
  // missing `palette` in a file, missing manifest `name`).
  | 'missing'
  // A unique-constraint violation: an element that should appear at most once
  // appears more than once (e.g. duplicate `palette`, duplicate part name,
  // duplicate socket within a part, duplicate `size` within a part).
  | 'duplicate'
  // An unrecognized name appears where the spec defines a closed set of names
  // (e.g. unknown keyword in `voxels.cvox`, unknown JSON field in manifest).
  | 'unknown'
  // A value is present but malformed: bad hex color, voxel-row character
  // outside the palette alphabet, palette index out of range, identifier
  // failing the §5 regex, size dimension out of range, etc.
  | 'invalid-value'
  // An incorrect number of items: wrong arg count for a keyword, voxel-row
  // width not matching `W`, row count per layer not matching `D`, palette
  // exceeding 62 colors.
  | 'wrong-arity';

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(
  code: CuboidyErrorCode,
  message: string,
): Result<T> {
  return { ok: false, code, message };
}
