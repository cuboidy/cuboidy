import type { Diagnostic } from '../diagnostic.js';
import type { InlineAnimation } from '../animation.js';
import type { Manifest } from '../manifest.js';
import {
  boundsOf,
  openPlanesFor,
  type OpenPlane,
  type RestPlacement,
} from '../open-boundary.js';
import type { ResolvedPart } from '../project.js';
import { computeRestWorldTransforms, pivotRotsOf } from '../rig-transform.js';

// H05 — a part that sits on an open boundary (§6.14) and is animated.
//
// An open boundary is a statement about where the package's OUTSIDE is, and
// the bake reads it in the rest pose. A part that moves takes its faces off
// the declared plane, so the hole left where the seam faces were stops being
// covered by anything: the model opens, mid-clip, from one side only. Nothing
// else in the toolchain sees it — a still render is the rest pose, which is
// precisely the pose where the omission is correct.
//
// A hint rather than a warning, and §11.1 settles it: the model is spec-valid,
// and an author can have a reason (a lid that only ever opens away from the
// seam, a clip that is never played where the packages abut). `--strict` fails
// on warnings, so a stop here would make a legitimate package unpublishable
// over a judgement call.
//
// Scoped to parts that are actually ON a plane. A manifest-level declaration
// applies to every part, and an animated part deep inside the package has
// nothing on the seam to lose — reporting it would train the reader to skip
// the rule.
export function checkOpenBoundaries(
  manifest: Manifest,
  parts: ReadonlyMap<string, ResolvedPart>,
  anims: ReadonlyMap<string, InlineAnimation>,
  out: Diagnostic[],
): void {
  if (
    manifest.openBoundaries === undefined &&
    !manifest.parts.some((p) => p.openBoundaries !== undefined)
  ) {
    return;
  }

  const transforms = computeRestWorldTransforms(
    manifest.parts,
    pivotRotsOf(Array.from(parts, ([name, r]) => [name, r.part] as const)),
  );
  const placements = new Map<string, RestPlacement>();
  for (const mp of manifest.parts) {
    const resolved = parts.get(mp.name);
    const transform = transforms.get(mp.name);
    if (resolved === undefined || transform === undefined) continue;
    placements.set(mp.name, { part: resolved.part, transform, scale: mp.scale });
  }

  for (const [name, planes] of openPlanesFor(manifest, placements)) {
    const box = boundsOf([placements.get(name)!]);
    const on = planes.filter(
      (p: OpenPlane) => (p.positive ? box.max[p.axis] : box.min[p.axis]) === p.at,
    );
    if (on.length === 0) continue;
    const clips = [...anims]
      .filter(([, anim]) => anim.parts[name] !== undefined)
      .map(([clip]) => clip);
    if (clips.length === 0) continue;
    out.push({
      code: 'invalid-value',
      severity: 'hint',
      ruleId: 'H05',
      message:
        `part '${name}' lies on the open boundary ${on.map((p) => p.face).join(', ')} ` +
        `and is animated by ${clips.map((c) => `'${c}'`).join(', ')} — ` +
        'the bake omits its seam faces in the rest pose, and the hole shows once it moves (§6.14)',
    });
  }
}
