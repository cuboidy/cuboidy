import type { KeyAttr } from '@cuboidy/core';

// View-level types the panels speak in.
//
// Shared because they describe the VIEW, not the document. `LoadedSource`
// — the editor's one-model state — deliberately stayed behind: a workspace
// holds a scene of several models and must not inherit a type that assumes
// exactly one. These carry no such assumption.
//
// The two that describe what the 3D scene draws — `GizmoVisibility` and
// `TransformSubTarget` — went to `@cuboidy/r3f`, where the components that
// read them live.

// View modes for the 3D scene. Rig view requires a manifest; anim view
// additionally requires the manifest to define at least one inline
// animation. The UI disables each toggle when its requirement is unmet.
export type ViewMode = 'geometry' | 'rig' | 'anim';

// Preview toolbar tools. 'select'
// is the safe default: nothing model-mutating can happen in it. A tool
// that isn't usable in the current view is disabled in the toolbar and
// the effective tool falls back to 'select' without losing the user's
// choice.
export type PreviewTool =
  | 'select'
  | 'move'
  | 'rotate'
  | 'attach'
  | 'erase'
  | 'paint';

// One cell of a voxel-tool stroke, in part-local voxel
// coords. `value` is a palette index, or AIR for an erase.
export interface VoxelEdit {
  x: number;
  y: number;
  z: number;
  value: number;
}

// A keyframe selected in the animation timeline: one attribute (rot/pos/
// scale/visible) of one part at one time-key. The per-attribute model means
// selection is an (attribute, time) pair, not a whole-keyframe marker.
export interface SelectedKey {
  part: string;
  attr: KeyAttr;
  timeKey: string;
}
