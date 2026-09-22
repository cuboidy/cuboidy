// What the scene components take beyond the model itself: which overlays
// are on, and what the transform tools are gripping. Props, not state —
// the app that mounts these owns both, and the workspace deliberately does
// not use the editor's vocabulary for its own toolbar.

// Per-kind visibility of the selected part's 3D preview gizmos (pivot
// marker, socket markers, bounding frame), toggled from the preview
// overlay. The flags outlive any one selection — gizmos simply render
// only while a part is selected.
export interface GizmoVisibility {
  pivot: boolean;
  sockets: boolean;
  frame: boolean;
}

// What the transform tools are gripping within the selected part: the part
// body itself, its pivot marker, or one of its socket markers. Picked by
// clicking the marker; resets to the body on selection change.
export type TransformSubTarget =
  | { kind: 'part' }
  | { kind: 'pivot' }
  | { kind: 'socket'; socket: string };
