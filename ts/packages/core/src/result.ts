export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: CuboidyErrorCode; message: string };

export type CvoxErrorCode =
  | 'E01'
  | 'E02'
  | 'E03'
  | 'E04'
  | 'E05'
  | 'E06'
  | 'E07'
  | 'E08'
  | 'E09'
  | 'E10'
  | 'E11'
  | 'E12'
  | 'E13'
  | 'E14'
  | 'E15'
  | 'E16'
  | 'E17'
  | 'E19';

export type ManifestErrorCode = 'C01' | 'C02' | 'C13';

export type CuboidyErrorCode = CvoxErrorCode | ManifestErrorCode;

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: CuboidyErrorCode, message: string): Result<T> {
  return { ok: false, code, message };
}
