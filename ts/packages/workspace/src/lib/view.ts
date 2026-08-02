// What the 3D scene shows, and what the pointer does in it.
//
// Deliberately NOT @cuboidy/ui's ViewMode / PreviewTool. Those are the
// editor's sets, and the differences are real rather than cosmetic: this
// app has no geometry view (a scene has no single geometry file to be
// faithful to) and no voxel tools (it arranges models, it does not carve
// them). The controls are shared; the lists are each app's own.

// Rig view is the arrangement at rest — animation out of the way so the
// composition can be read. Anim view plays it.
export type SceneViewMode = 'rig' | 'anim';

export type SceneTool = 'select' | 'move' | 'rotate';

// The overlays drawn on the SELECTED instance. Same three-toggle shape as
// the editor's per-part gizmos, one step up: a model's origin rather than
// a part's pivot, the sockets it PUBLISHES (§6.12) rather than every
// socket its parts declare, and a frame around the whole model.
export interface SceneGizmos {
  origin: boolean;
  sockets: boolean;
  frame: boolean;
}

// Sockets and the selection frame on by default: this app is about
// hooking models onto each other, and both are how you see that happen.
// The origin cross is the specialist of the three — it matters when you
// are lining a guest up by hand — so it stays off until asked for.
export const DEFAULT_GIZMOS: SceneGizmos = {
  origin: false,
  sockets: true,
  frame: true,
};
