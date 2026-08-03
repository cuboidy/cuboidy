export {
  ManifestSchema,
  ManifestPartSchema,
  PublishedSocketSchema,
  manifestGeometry,
  parseManifest,
} from './manifest.js';
export type { Manifest, ManifestPart, PublishedSocket } from './manifest.js';

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
  toInlineGeometry,
  SPEC_VERSION,
} from './geometry/serialize.js';
export { GeometrySchema, GeometryPartSchema } from './geometry/schema.js';
export type { GeometryDoc, GeometryDocPart } from './geometry/schema.js';

export { parseHexColor, serializeColor } from './geometry/palette.js';
export {
  duplicatePart,
  mirrorGeometry,
  mirrorPart,
  remapPartPalette,
  type Axis,
} from './geometry/transform.js';

export { AIR, indexToChar } from './geometry/voxel-row.js';
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
  MANIFEST_FILE,
  geometryPaths,
  normalizeRefPath,
  projectFilePaths,
  resolvePartGeometry,
  resolveRefFrom,
  resolveProject,
} from './project.js';
export type {
  GeometryFile,
  ProjectDiagnostic,
  ProjectPaths,
  ResolvedPart,
  ResolvedProject,
  UnresolvedPart,
} from './project.js';

export {
  publishedSocketFrame,
  publishedSocketFrames,
  socketFrameOn,
  worldTransformsFor,
} from './socket-frame.js';
export type { SocketFrame } from './socket-frame.js';

export { buildMesh } from './mesh.js';
export type { MeshData } from './mesh.js';

// The named viewpoints. Exported so a browser app can render a model from
// the SAME angle cuboidy-snap does rather than inventing its own — a
// library thumbnail and a contact sheet showing the model differently
// would be two products. Pure math (camera.ts depends only on vec.ts), so
// this pulls no CLI or Node code into a bundle.
export { ANGLES, CARDINAL_IDS, CORNER_IDS, STANDARD_IDS, cameraDir } from './render/camera.js';
export type { Angle } from './render/camera.js';

export {
  QUAT_IDENTITY,
  composePartRotation,
  computeRestWorldTransforms,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
} from './rig-transform.js';
export type {
  AnimPose,
  QuatTuple,
  Vec3Tuple,
  WorldTransform,
} from './rig-transform.js';

export { validateCrossFile, validateProject } from './lint/cross-file.js';
export type { ProjectInput } from './lint/cross-file.js';
export { lintGeometry } from './lint/voxel-rules.js';
export type { Diagnostic, LintRuleId, Severity } from './diagnostic.js';

export { isIdentifier } from './identifier.js';

export type { CuboidyErrorCode, Result } from './result.js';
