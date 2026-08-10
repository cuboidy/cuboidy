export {
  ManifestSchema,
  ManifestPartSchema,
  PublishedSocketSchema,
  manifestGeometry,
  parseManifest,
} from './manifest.js';
export type { Manifest, ManifestPart, PublishedSocket } from './manifest.js';

export {
  PaletteFileSchema,
  parsePaletteFile,
  parsePaletteFileText,
} from './palette-file.js';
export { MAX_PALETTE } from './geometry/palette.js';

export {
  AnimationsSchema,
  AnimationSchema,
  InlineAnimationSchema,
  AnimationTrackSchema,
  KeyframeSchema,
  TIME_KEY_RE,
  clampToClip,
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

export { EASING_NAMES, DEFAULT_EASING, applyEasing } from './easing.js';
export type { EasingName } from './easing.js';

export {
  clampRetime,
  formatTimeKey,
  nearestExistingKey,
  retimeWindow,
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

export {
  MATTE,
  isMatte,
  paletteEntryFrom,
  parseHexColor,
  serializeColor,
  serializePaletteEntry,
} from './geometry/palette.js';
export type { PaletteEntryDoc } from './geometry/palette.js';
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
  Material,
  Palette,
  PaletteEntry,
  Part,
  Pivot,
  Size,
  Socket,
  Vec3,
  Vec3Tuple,
} from './geometry/types.js';

export {
  MANIFEST_FILE,
  geometryPaths,
  normalizeRefPath,
  // The two-round IO staging protocol, in the order a host must call it:
  // projectFilePaths → read → resolveGeometries → palettePathsOf → read →
  // resolveProject. §7.4 palette references live inside geometry files, so
  // the second round cannot be skipped. Published because every host does
  // this and none of them can do it from `resolveProject` alone — see
  // "Loading a package off disk" in docs/csharp-implementation.md.
  palettePathsOf,
  projectFilePaths,
  resolveGeometries,
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
  DuplicatePartName,
  UnresolvedPart,
} from './project.js';

export {
  composeFrames,
  publishedSocketFrame,
  publishedSocketFrames,
  socketFrameOn,
  worldTransformsFor,
} from './socket-frame.js';
export type { SocketFrame } from './socket-frame.js';

export { buildMesh } from './mesh.js';
export type { MeshData, MeshGroup, MeshMaterial } from './mesh.js';

// The named viewpoints. Exported so a browser app can render a model from
// the SAME angle cuboidy-snap does rather than inventing its own — a
// library thumbnail and a contact sheet showing the model differently
// would be two products. Pure math (camera.ts depends only on vec.ts), so
// this pulls no CLI or Node code into a bundle.
export {
  ANGLES,
  CARDINAL_IDS,
  CORNER_IDS,
  STANDARD_IDS,
  UNDER_IDS,
  cameraDir,
} from './render/camera.js';
export type { Angle } from './render/camera.js';

export {
  QUAT_IDENTITY,
  composePartRotation,
  computeRestWorldTransforms,
  partsWorldBounds,
  pivotRotsOf,
  localPointToWorld,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
} from './rig-transform.js';
export type {
  Frame,
  QuatTuple,
  WorldTransform,
} from './rig-transform.js';

export { validateProject } from './lint/cross-file.js';
export type { ProjectInput } from './lint/cross-file.js';
export { lintGeometry } from './lint/voxel-rules.js';
export { CROSS_FILE, lintProject } from './lint/project-lint.js';
export type { FileDiagnostic, ProjectLintInput } from './lint/project-lint.js';
export type {
  Diagnostic,
  LintRuleId,
  ResolutionDiagnostic,
  Severity,
} from './diagnostic.js';

export { buildForest, resolveHierarchy } from './forest.js';
export type { DroppedEdge, Hierarchy } from './forest.js';
export type { ForestNode } from './forest.js';

export { isIdentifier } from './identifier.js';

export type { CuboidyErrorCode, Result } from './result.js';
