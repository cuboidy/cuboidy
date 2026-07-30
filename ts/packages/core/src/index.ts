export {
  ManifestSchema,
  ManifestPartSchema,
  manifestGeometry,
  parseManifest,
} from './manifest.js';
export type { Manifest, ManifestPart } from './manifest.js';

export { PaletteFileSchema, parsePaletteFile } from './palette-file.js';
export { MAX_PALETTE } from './geometry/palette.js';

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

export { serializeColor } from './geometry/palette.js';
export {
  duplicatePart,
  mirrorGeometry,
  mirrorPart,
  remapPartPalette,
  type Axis,
} from './geometry/transform.js';

export { AIR } from './geometry/voxel-row.js';
export type {
  Color,
  Geometry,
  Palette,
  Part,
  Pivot,
  Size,
  Socket,
  Vec3,
} from './geometry/types.js';

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
export { lintGeometry } from './lint/voxel-rules.js';
export type { Diagnostic, LintRuleId, Severity } from './diagnostic.js';

export { isIdentifier } from './identifier.js';

export type { CuboidyErrorCode, Result } from './result.js';
