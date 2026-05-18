import type { Diagnostic } from '../diagnostic.js';
import type { VoxelDefinition } from '../cvox/parse.js';
import type { Manifest } from '../manifest.js';

export function validateCrossFile(
  manifest: Manifest,
  voxelDef: VoxelDefinition,
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

  return diags;
}
