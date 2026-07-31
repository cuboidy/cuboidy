// The test corpus: small, purpose-built models that the suite owns.
//
// Tests used to reach into `models/` — the shipped examples — which made the
// example gallery load-bearing for the test suite. Replacing an example then
// broke a dozen unrelated tests, and the examples exist to look good, not to
// hold still. They are decoupled now: behaviour is pinned to these four
// models, and the only thing still asserted about `models/` is that whatever
// is in it lints clean (lint-runner.test.ts), discovered by walking the
// directory rather than by name.
//
// Each corpus model covers one shape of the format:

/** Multi-part rig with a hierarchy, sockets, an l/r pair and two inline clips. */
export const RIGGED = 'ts/testdata/rigged';

/** One part, no hierarchy — the accessory case. */
export const SINGLE = 'ts/testdata/single';

/** Manifest `geometry` list, a shared external palette, an external clip. */
export const MULTIFILE = 'ts/testdata/multifile';

/**
 * An l/r pair that is mirror-symmetric in geometry while its manifest
 * positions are NOT sign-opposite (-2 and 0, because both legs keep the same
 * local pivot). W06 must stay silent here: it is the audit's D-2 false
 * positive, and the check is geometric for exactly this reason.
 */
export const MIRRORED = 'ts/testdata/mirrored';

/** Every part `RIGGED`'s geometry defines, in hierarchy order. */
export const RIGGED_PARTS: ReadonlyArray<{ name: string; parent?: string }> = [
  { name: 'body' },
  { name: 'head', parent: 'body' },
  { name: 'tail', parent: 'body' },
  { name: 'leg-l', parent: 'body' },
  { name: 'leg-r', parent: 'body' },
];
