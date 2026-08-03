import { Vector3, type Camera, type Object3D } from 'three';
import { socketCandidates } from './drop.js';
import type { PlacedInstance } from './scene-resolve.js';

// E2E test probes over the RENDERED scene — not part of the app's
// behavior; a build flag could strip the two call sites wholesale. Each
// installer returns its cleanup, for a useEffect.
//
// They exist because the questions are about the render rather than the
// resolved data, and a canvas cannot be asked:
//   __renderHost    the instance whose group actually contains this one
//   __renderWorld   where its group actually ends up
//   __renderMeshes  how many meshes it is drawing OF ITS OWN
//   __socketPixel   where a published socket lands on screen (a drop is
//                   aimed with the pointer, so a test that wants to
//                   prove the aiming works has to know where to aim)

export function installRenderProbes(
  groups: ReadonlyMap<string, Object3D>,
): () => void {
  const w = window as unknown as {
    __renderHost?: (id: string) => string | null;
    __renderWorld?: (id: string) => [number, number, number] | null;
    __renderMeshes?: (id: string) => number;
  };
  // Of its OWN: the walk stops at any descendant that is another
  // instance's group, so a hidden host carrying a visible guest reads
  // zero rather than counting the guest's meshes as its own.
  w.__renderMeshes = (id) => {
    const g = groups.get(id);
    if (g === undefined) return 0;
    let n = 0;
    const walk = (o: Object3D): void => {
      for (const c of o.children) {
        if (typeof c.userData['instanceId'] === 'string') continue;
        if ((c as { isMesh?: boolean }).isMesh === true) n += 1;
        walk(c);
      }
    };
    walk(g);
    return n;
  };
  w.__renderHost = (id) => {
    let o = groups.get(id)?.parent ?? null;
    while (o !== null) {
      const owner = o.userData['instanceId'];
      if (typeof owner === 'string') return owner;
      o = o.parent;
    }
    return null;
  };
  w.__renderWorld = (id) => {
    const g = groups.get(id);
    if (g === undefined) return null;
    g.updateWorldMatrix(true, false);
    const v = new Vector3().setFromMatrixPosition(g.matrixWorld);
    return [v.x, v.y, v.z];
  };
  return () => {
    delete w.__renderHost;
    delete w.__renderWorld;
    delete w.__renderMeshes;
  };
}

// Read-only, and the same projection the drag uses. Lazily computed per
// call — tests invoke it a handful of times, so re-deriving the
// candidates then is cheaper than keeping them fresh for a probe.
export function installSocketPixelProbe(
  placed: readonly PlacedInstance[],
  camera: { current: Camera | null },
  el: { current: HTMLDivElement | null },
): () => void {
  const w = window as unknown as {
    __socketPixel?: (host: string, socket: string) => [number, number] | null;
  };
  w.__socketPixel = (host, socket) => {
    const cam = camera.current;
    const div = el.current;
    if (cam === null || div === null) return null;
    const hit = socketCandidates(placed).find(
      (c) => c.host === host && c.socket === socket,
    );
    if (hit === undefined) return null;
    const rect = div.getBoundingClientRect();
    const v = new Vector3(...hit.frame.pos).project(cam);
    if (v.z > 1) return null;
    return [((v.x + 1) / 2) * rect.width, ((-v.y + 1) / 2) * rect.height];
  };
  return () => {
    delete w.__socketPixel;
  };
}
