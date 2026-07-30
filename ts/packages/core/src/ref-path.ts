import { z } from 'zod';

// The §8 rules as a single regex, for the generated JSON Schema (Zod
// refinements are runtime-only and would otherwise leave ref slots as
// plain strings there). Kept in exact parity with the refinements
// below — json-schema.test.ts feeds both validators the same corpus:
//   (?!/)     no absolute path
//   (?!.*//)  no empty segment ('//'; a leading '/' is the case above
//             and a trailing one is impossible with the extension)
//   [^\\:]+   no backslash, no ':' (URLs / namespace:key URIs), and at
//             least one character before the extension
export function refPathPattern(ext: string): string {
  return `^(?!/)(?!.*//)[^\\\\:]+${ext.replace('.', '\\.')}$`;
}

// SPEC §8 reference path, parameterized by the required extension — `.json`
// for every reference kind now that geometry is JSON too, but kept a parameter
// because the rule is about the path shape, not the suffix.
// Syntax-only: whether the target exists — and
// whether a `../` path is loadable at all — is the consuming tool's
// concern. Refinements (not one regex) so each violation gets a
// specific message; `.meta()` carries the equivalent `pattern` into the
// generated JSON Schema.
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
    })
    .meta({ pattern: refPathPattern(ext) });
}
