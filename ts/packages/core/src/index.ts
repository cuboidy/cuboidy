export {
  ManifestSchema,
  ManifestPartSchema,
  manifestGeometry,
  parseManifest,
} from './manifest.js';
export type { Manifest, ManifestPart } from './manifest.js';

export { PaletteFileSchema, parsePaletteFile } from './palette-file.js';
export { MAX_PALETTE } from './cvox/palette.js';

export {
  AnimationsSchema,
  AnimationSchema,
  InlineAnimationSchema,
  AnimationTrackSchema,
  KeyframeSchema,
  isInlineAnimation,
  samplePart,
  sampleAnimation,
} from './animation.js';
export type {
  Animation,
  InlineAnimation,
  AnimationTrack,
  Keyframe,
  EaseMap,
  Pose,
} from './animation.js';

export { EASING_NAMES, DEFAULT_EASING, applyEasing } from './easing.js';
export type { EasingName } from './easing.js';

export {
  formatTimeKey,
  nearestExistingKey,
  sortTrackKeys,
  setAttrAtKey,
  addAttrAtTime,
  deleteAttrAtKey,
  moveAttrKey,
  trimTrackKeys,
  restValue,
  setEaseAtKey,
  mergeKeyframeAtTime,
} from './animation-edit.js';
export type { KeyAttr, AttrValue, EaseAttr } from './animation-edit.js';

export { parseGeometry, parseGeometryText } from './geometry/parse.js';
export { locateJsonPath, positionAt } from './geometry/locate.js';
export type { Position } from './geometry/locate.js';
export {
  formatGeometryDoc,
  serializeGeometry,
  toGeometryDoc,
  SPEC_VERSION,
} from './geometry/serialize.js';
export { GeometrySchema, GeometryPartSchema } from './geometry/schema.js';
export type { GeometryDoc, GeometryDocPart } from './geometry/schema.js';

// Retired text format — still exported while the migration finishes so the
// remaining cvox tests and the test-fixture bridge can reach it. Removed in
// the deletion phase (docs/json-migration.md).
export { parseCvox } from './cvox/parse.js';
export { serializeColor, serializeCvox } from './cvox/serialize.js';
export {
  duplicatePart,
  mirrorGeometry,
  mirrorPart,
  remapPartPalette,
  type Axis,
} from './cvox/transform.js';

export { AIR } from './cvox/voxel-row.js';
export type {
  Color,
  Cvox,
  Palette,
  Part,
  Pivot,
  Size,
  Socket,
  Vec3,
} from './cvox/types.js';

export {
  normalizeRefPath,
  projectFilePaths,
  resolveProject,
} from './project.js';
export type {
  GeometryFile,
  ProjectDiagnostic,
  ProjectPaths,
  ResolvedProject,
} from './project.js';

export { buildMesh } from './mesh.js';
export type { MeshData } from './mesh.js';

export {
  QUAT_IDENTITY,
  composePartRotation,
  computeRestWorldTransforms,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
} from './rig-transform.js';
export type { QuatTuple, Vec3Tuple, WorldTransform } from './rig-transform.js';

export { validateCrossFile, validateProject } from './lint/cross-file.js';
export type { ProjectInput } from './lint/cross-file.js';
export { lintCvox } from './lint/voxel-rules.js';
export type { Diagnostic, LintRuleId, Severity } from './diagnostic.js';

export { isIdentifier } from './identifier.js';

export type { CuboidyErrorCode, Result } from './result.js';
