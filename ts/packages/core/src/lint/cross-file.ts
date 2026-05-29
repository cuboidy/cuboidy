import type { Diagnostic } from '../diagnostic.js';
import type { Cvox } from '../cvox/types.js';
import type { Manifest } from '../manifest.js';

export function validateCrossFile(
  manifest: Manifest,
  voxelDef: Cvox,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const manifestParts = new Set(manifest.parts.map((p) => p.name));
  const voxelParts = new Set(voxelDef.parts.map((p) => p.name));

  for (const name of manifestParts) {
    if (!voxelParts.has(name)) {
      diags.push({
        code: 'missing',
        severity: 'error',
        message: `part '${name}' is in manifest but not in voxels.cvox`,
      });
    }
  }

  for (const name of voxelParts) {
    if (!manifestParts.has(name)) {
      diags.push({
        code: 'unknown',
        severity: 'warning',
        message: `part '${name}' is in voxels.cvox but not in manifest`,
      });
    }
  }

  checkLrSymmetry(manifest, diags); // W06

  return diags;
}

// W06 — an `<base>-l` / `<base>-r` (or `_l` / `_r`) manifest pair, sharing a
// parent, whose positions are not X-symmetric (pos_l.x === -pos_r.x and y/z
// equal). A cvox-side `mirror` reflects voxels but NOT the manifest position,
// so the hand-written mirror position is exactly where bilateral rigs drift
// asymmetric (SPEC §7.5.1). Advisory warning.
function checkLrSymmetry(manifest: Manifest, out: Diagnostic[]): void {
  const byName = new Map(manifest.parts.map((p) => [p.name, p]));
  for (const p of manifest.parts) {
    const n = p.name;
    if (n.length < 2 || !n.endsWith('l')) continue;
    const sep = n[n.length - 2];
    if (sep !== '-' && sep !== '_') continue;
    const rName = n.slice(0, -1) + 'r';
    const r = byName.get(rName);
    if (r === undefined) continue;
    if ((p.parent ?? null) !== (r.parent ?? null)) continue; // different frames
    const [lx, ly, lz] = p.position ?? [0, 0, 0];
    const [rx, ry, rz] = r.position ?? [0, 0, 0];
    if (!(lx === -rx && ly === ry && lz === rz)) {
      out.push({
        code: 'invalid-value',
        severity: 'warning',
        ruleId: 'W06',
        message: `l/r pair '${n}' / '${rName}' positions are not X-symmetric: [${lx}, ${ly}, ${lz}] vs [${rx}, ${ry}, ${rz}]`,
      });
    }
  }
}
