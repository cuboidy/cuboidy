import { z } from 'zod';

// SPEC §8 reference path, parameterized by the required extension
// (`.cvox` for geometry entries, `.json` for the palette binding and
// animation references). Syntax-only: whether the target exists — and
// whether a `../` path is loadable at all — is the consuming tool's
// concern.
export function refPath(ext: string) {
  return z
    .string()
    .refine((s) => s.endsWith(ext) && s.length > ext.length, {
      message: `must be a relative path ending in ${ext}`,
    })
    .refine((s) => !s.includes('\\'), {
      message: 'must use forward slashes',
    })
    .refine((s) => !s.startsWith('/'), {
      message: 'absolute paths are forbidden',
    })
    .refine((s) => !s.includes(':'), {
      message: 'URLs and namespace:key URIs are forbidden',
    })
    .refine((s) => !s.split('/').includes(''), {
      message: 'empty path segment',
    });
}
