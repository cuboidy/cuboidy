import type { Diagnostic } from '../diagnostic.js';
import type { Cvox, Part, Size, Vec3 } from '../cvox/types.js';
import { AIR } from '../cvox/voxel-row.js';

// SPEC §11.3 (W01–W05) + §11.4 (H01–H02): semantic lint over a parsed Cvox.
// `lintCvox` runs AFTER `parseCvox` has accepted the input, so every rule
// here assumes a well-formed AST (size matches voxels layout, palette
// indices in range, etc.). Lint never returns errors — only warnings and
// hints — so its diagnostics are purely advisory; consumers may render
// or suppress them independently of structural parse errors.
//
// Per-part rules iterate in declared order; the cross-part rule (W03) runs
// once at the end. This order is stable across runs so output diffs are
// meaningful in CI / golden-file tests.

export function lintCvox(cvox: Cvox): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const part of cvox.parts) {
    checkPivotBounds(part, diags);     // W01
    checkSocketBounds(part, diags);    // W02
    checkVoxelEmptiness(part, diags);  // W04 + W05 (W05 suppresses W04)
    checkPartName(part, diags);        // H01
    checkPivotFractional(part, diags); // H02
  }
  checkUnusedPalette(cvox, diags);     // W03
  return diags;
}

// W01 — pivot position outside the part's bounding box.
// Bounds are [0, size.dim] inclusive on each axis: a pivot at the far
// corner (e.g. `[W, 0, D]`) is in-bounds, since voxel coordinates span
// 0..W. Rotation, if any, is not bounds-checked (rotations are unitless).
function checkPivotBounds(part: Part, out: Diagnostic[]): void {
  if (!inGrid(part.pivot.pos, part.size)) {
    out.push({
      code: 'invalid-value',
      severity: 'warning',
      ruleId: 'W01',
      message: `pivot ${fmtVec(part.pivot.pos)} outside grid bounds ${fmtSize(part.size)} in part '${part.name}'`,
    });
  }
}

// W02 — socket position outside the part's bounding box.
// Same bounds rule as W01; emitted once per offending socket, preserving
// socket declaration order.
function checkSocketBounds(part: Part, out: Diagnostic[]): void {
  for (const s of part.sockets) {
    if (!inGrid(s.pos, part.size)) {
      out.push({
        code: 'invalid-value',
        severity: 'warning',
        ruleId: 'W02',
        message: `socket '${s.name}' position ${fmtVec(s.pos)} outside grid bounds ${fmtSize(part.size)} in part '${part.name}'`,
      });
    }
  }
}

// W03 — palette index declared but never referenced by any voxel cell
// (in any part). AIR is excluded by construction since `AIR === -1`.
// Reported per-index in declaration order. A 1-color palette with no
// solid voxels (W05 case) still triggers W03 alongside W05.
function checkUnusedPalette(cvox: Cvox, out: Diagnostic[]): void {
  const used = new Set<number>();
  for (const part of cvox.parts) {
    for (const layer of part.voxels) {
      for (const row of layer) {
        for (const idx of row) {
          if (idx !== AIR) used.add(idx);
        }
      }
    }
  }
  for (let i = 0; i < cvox.palette.length; i++) {
    if (!used.has(i)) {
      out.push({
        code: 'invalid-value',
        severity: 'warning',
        ruleId: 'W03',
        message: `palette index ${i} is declared but never used`,
      });
    }
  }
}

// W04 / W05 — emptiness checks. Done in one pass for two reasons:
// (1) we can short-circuit; (2) we naturally suppress W04 when W05 fires.
// Rationale for the suppression: W05 means every Y-layer is empty, so
// emitting H copies of W04 alongside W05 is pure noise. Each rule still
// reports independently when only one applies (single empty layer in an
// otherwise solid part → W04 only; all empty → W05 only).
function checkVoxelEmptiness(part: Part, out: Diagnostic[]): void {
  const emptyLayers: number[] = [];
  let anySolid = false;
  for (let y = 0; y < part.voxels.length; y++) {
    if (isLayerEmpty(part.voxels[y]!)) {
      emptyLayers.push(y);
    } else {
      anySolid = true;
    }
  }
  if (!anySolid) {
    out.push({
      code: 'invalid-value',
      severity: 'warning',
      ruleId: 'W05',
      message: `part '${part.name}' has no solid voxels`,
    });
    return; // W05 fired → suppress W04
  }
  for (const y of emptyLayers) {
    out.push({
      code: 'invalid-value',
      severity: 'warning',
      ruleId: 'W04',
      message: `part '${part.name}' layer y=${y} is entirely empty`,
    });
  }
}

function isLayerEmpty(layer: readonly (readonly number[])[]): boolean {
  for (const row of layer) {
    for (const idx of row) {
      if (idx !== AIR) return false;
    }
  }
  return true;
}

// H01 — part name convention check. The §5 identifier rule is broader
// (`[a-zA-Z_][a-zA-Z0-9_-]*` with reserved-keyword exclusion), so names
// like `Head`, `_arm`, or `armOne` pass parsing but fail style. The
// recommended convention is lower_snake_case OR lower-kebab-case:
//   - starts with [a-z]
//   - body is [a-z0-9] segments separated by single `_` or `-`
//   - no trailing or doubled separator
// Both styles are permitted (and may be mixed within a project), but a
// single name should pick one — `head_top` and `head-top` are each fine,
// `head_-top` is not.
const SNAKE_OR_KEBAB_RE = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/;

function checkPartName(part: Part, out: Diagnostic[]): void {
  if (!SNAKE_OR_KEBAB_RE.test(part.name)) {
    out.push({
      code: 'invalid-value',
      severity: 'hint',
      ruleId: 'H01',
      message: `part name '${part.name}' should be lower_snake_case or lower-kebab-case`,
    });
  }
}

// H02 — fractional pivot in an otherwise-integer-aligned context.
// The natural default pivot for odd dimensions is `[W/2, 0, D/2]`, which
// is fractional (e.g. 1.5 for W=3). That's not a typo, that's the
// geometric center, so we skip it. Any other fractional pivot is hinted —
// the writer likely meant to round to an integer voxel coordinate.
function checkPivotFractional(part: Part, out: Diagnostic[]): void {
  const p = part.pivot.pos;
  const hasFractional =
    !Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.z);
  if (!hasFractional) return;
  if (isDefaultPivotPos(p, part.size)) return;
  out.push({
    code: 'invalid-value',
    severity: 'hint',
    ruleId: 'H02',
    message: `pivot ${fmtVec(p)} uses fractional values in part '${part.name}'`,
  });
}

function isDefaultPivotPos(p: Vec3, size: Size): boolean {
  return p.x === size.w / 2 && p.y === 0 && p.z === size.d / 2;
}

function inGrid(v: Vec3, size: Size): boolean {
  return (
    v.x >= 0 && v.x <= size.w &&
    v.y >= 0 && v.y <= size.h &&
    v.z >= 0 && v.z <= size.d
  );
}

function fmtVec(v: Vec3): string {
  return `[${v.x}, ${v.y}, ${v.z}]`;
}

function fmtSize(s: Size): string {
  return `[0..${s.w}, 0..${s.h}, 0..${s.d}]`;
}
