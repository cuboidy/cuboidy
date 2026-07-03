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
  Pose,
} from './animation.js';

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
} from './animation-edit.js';
export type { KeyAttr, AttrValue } from './animation-edit.js';

export { parseCvox } from './cvox/parse.js';
export { serializeColor, serializeCvox } from './cvox/serialize.js';

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

export { buildMesh } from './mesh.js';
export type { MeshData } from './mesh.js';

export { validateCrossFile, validateProject } from './lint/cross-file.js';
export type { ProjectInput } from './lint/cross-file.js';
export { lintCvox } from './lint/voxel-rules.js';
export type { Diagnostic, LintRuleId, Severity } from './diagnostic.js';

export { isIdentifier } from './identifier.js';

export type { CuboidyErrorCode, Result } from './result.js';
