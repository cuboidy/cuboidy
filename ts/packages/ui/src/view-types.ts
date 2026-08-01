import type { KeyAttr } from '@cuboidy/core';

// View-level types: what the 3D scene and the panels around it speak in.
//
// Shared because they describe the VIEW, not the document. `LoadedSource`
// — the editor's one-model state — deliberately stayed behind: a workspace
// holds a scene of several models and must not inherit a type that assumes
// exactly one. These carry no such assumption.

// View modes for the 3D scene. Rig view requires a manifest; anim view
// additionally requires the manifest to define at least one inline
// animation. The UI disables each toggle when its requirement is unmet.
export type ViewMode = 'geometry' | 'rig' | 'anim';

// Per-kind visibility of the selected part's 3D preview gizmos (pivot
// marker, socket markers, bounding frame), toggled from the preview
// overlay. The flags outlive any one selection — gizmos simply render
// only while a part is selected.
export interface GizmoVisibility {
  pivot: boolean;
  sockets: boolean;
  frame: boolean;
}

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

// What the transform tools are gripping within the selected part: the part
// body itself, its pivot marker, or one of its socket markers. Picked by
// clicking the marker; resets to the body on selection change.
export type TransformSubTarget =
  | { kind: 'part' }
  | { kind: 'pivot' }
  | { kind: 'socket'; socket: string };

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
