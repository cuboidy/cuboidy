import type { Cvox, Manifest } from '@cuboidy/core';

// Builds a default Manifest from a Cvox AST. Used by the "Create
// manifest" action when a user wants to upgrade a cvox-only load into
// a folder so rig view becomes available.
//
// The default places every part at the origin with no parent. This is
// the most neutral starting point — Rig view immediately works but
// looks identical to Cvox view (all parts overlap), and the user can
// then edit parent/position in the (future) rig editor to compose the
// model.
//
// Name is derived from the cvox source file name with the `.cvox`
// extension stripped. Empty / extension-only names fall back to
// 'untitled' so the manifest always has a valid identifier-shaped
// name (parseManifest enforces the §5 identifier rule).

export function synthesizeManifest(cvox: Cvox, cvoxFileName: string): Manifest {
  return {
    name: deriveModelName(cvoxFileName),
    parts: cvox.parts.map((p) => ({
      name: p.name,
      position: [0, 0, 0],
    })),
  };
}

function deriveModelName(fileName: string): string {
  const base = fileName.replace(/\.cvox$/i, '').replace(/[^A-Za-z0-9_-]/g, '_');
  // Names must start with a letter or underscore (§5 identifier rule).
  // Prepend 'm_' if the derived base would start with a digit or is empty.
  if (base.length === 0 || /^[0-9-]/.test(base)) return 'untitled';
  return base;
}
