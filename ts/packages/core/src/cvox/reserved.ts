// SPEC §7.3.1: the cvox reserved keyword list. Consumed by
// identifier.ts — isIdentifier rejects these so `part part` errors
// as "invalid identifier 'part'" instead of parsing as a part literally
// named `part`. The 3 reserved punctuation tokens per §7.3.2 (`{` `}` `,`)
// don't need their own export because punct chars fail IDENTIFIER_RE
// anyway and no parser dispatches on a punct set; the only place punct
// matters is the inline `t.text === '{'` / `','` / `'}'` checks in
// voxels.ts and expect.ts.

export const RESERVED_KEYWORDS: readonly string[] = [
  'palette',
  'part',
  'size',
  'pivot',
  'socket',
  'voxels',
  'rot',
  // SPEC §7.5.1 part-reuse: clone (verbatim) / mirror (reflected). Reserved
  // so they cannot be used as identifiers (part/socket names); a voxel row
  // spelling them stays valid voxel data per §7.3.4 lexical isolation.
  'clone',
  'mirror',
];
