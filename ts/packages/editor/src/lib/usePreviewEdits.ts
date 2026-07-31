import { useCallback } from 'react';
import {
  AIR,
  composePartRotation,
  quatRotateVec3,
  type Manifest,
  type ManifestPart,
  type Part,
} from '@cuboidy/core';
import { mapGeometryFiles, mergeGeometries, withManifest } from './source-ops.js';
import type { LoadResult, VoxelEdit } from './types.js';

// Committing a direct manipulation in the 3D preview: the gizmo drags and
// the voxel-tool strokes.
//
// What separates these from the inspector's fields is that each gesture is
// ONE undo entry no matter how many values it moved. A move-gizmo drag
// writes a whole position (the inspector's number inputs coalesce per
// axis); a voxel stroke commits every painted cell of the drag at once;
// and a pivot drag rewrites the geometry pivot AND compensates the
// manifest so the render does not move — two files, one step.
//
// They build on the two per-part mutators rather than owning them, since
// the same mutators back the inspector.

interface Params {
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  editsBlocked: boolean;
  mutateGeometryPart: (
    tag: string | null,
    partName: string,
    build: (part: Part) => Part,
  ) => void;
  mutateManifestPart: (
    tag: string | null,
    partName: string,
    build: (entry: ManifestPart) => ManifestPart,
  ) => void;
}

export function usePreviewEdits({
  dispatchEdit,
  editsBlocked,
  mutateGeometryPart,
  mutateManifestPart,
}: Params) {
  // Move-gizmo drag commit (design §3): the whole drag lands as ONE
  // whole-position write = one undo entry (vs the per-axis coalescing
  // tags of the inspector's number inputs). mutateManifestPart creates
  // the manifest entry if the part didn't have one — dragging an
  // unplaced part places it.
  const handleGizmoMovePart = useCallback(
    (partName: string, position: [number, number, number]) => {
      mutateManifestPart(null, partName, (entry) => ({ ...entry, position }));
    },
    [mutateManifestPart],
  );

  // Rotate-gizmo drag commit: same one-undo shape. All-zero = identity
  // drops the field, matching the inspector's checkbox convention
  // (absent `rotation` is the SPEC default).
  const handleGizmoRotatePart = useCallback(
    (partName: string, rotation: [number, number, number]) => {
      mutateManifestPart(null, partName, (entry) => {
        if (rotation.every((v) => v === 0)) {
          const { rotation: _drop, ...rest } = entry;
          return rest;
        }
        return { ...entry, rotation };
      });
    },
    [mutateManifestPart],
  );

  // Pivot drag commit — ALWAYS compensated (design §2.3): ONE
  // dispatchEdit rewrites the geometry pivot AND the manifest so the
  // rendered model doesn't move, only the marker does. The part's own
  // position gains q_local·Δ (q_local = q_rotation ⊗ q_pivot — its
  // voxels are drawn at −pivot inside the rotated frame); each DIRECT
  // child loses Δ (children live inside that same rotated frame, so
  // the parent's compensation would carry them by exactly +Δ there).
  // Compensation values are derived math, rounded to 0.001 — tight
  // enough to keep the invariant, sane enough for the file.
  const handleGizmoMovePivot = useCallback(
    (partName: string, pos: [number, number, number]) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const part = mergeGeometries(src).parts.find(
          (p) => p.name === partName,
        );
        if (part === undefined) return current;
        const op = part.pivot.pos;
        if (op.x === pos[0] && op.y === pos[1] && op.z === pos[2]) {
          return current;
        }
        const delta: [number, number, number] = [
          pos[0] - op.x,
          pos[1] - op.y,
          pos[2] - op.z,
        ];
        const nextSrc = mapGeometryFiles(src, (geometry) => {
          const i = geometry.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const parts = geometry.parts.slice();
          parts[i] = {
            ...parts[i]!,
            pivot: {
              ...parts[i]!.pivot,
              pos: { x: pos[0], y: pos[1], z: pos[2] },
            },
          };
          return { ...geometry, parts };
        });
        if (nextSrc === src) return current;
        if (nextSrc.manifest === undefined) {
          // No rig to keep in place — a plain geometry edit.
          return { ...current, source: nextSrc };
        }
        const round3 = (v: number) => Math.round(v * 1000) / 1000;
        const m = nextSrc.manifest;
        const parts = m.parts.slice();
        const idx = parts.findIndex((p) => p.name === partName);
        const base: ManifestPart = idx >= 0 ? parts[idx]! : { name: partName };
        const pivotRot = part.pivot.rot;
        const qLocal = composePartRotation(
          base.rotation,
          pivotRot === undefined
            ? undefined
            : [pivotRot.x, pivotRot.y, pivotRot.z],
        );
        const off = quatRotateVec3(qLocal, delta);
        const bp = base.position ?? [0, 0, 0];
        const moved: ManifestPart = {
          ...base,
          position: [
            round3(bp[0] + off[0]),
            round3(bp[1] + off[1]),
            round3(bp[2] + off[2]),
          ],
        };
        if (idx >= 0) parts[idx] = moved;
        else parts.push(moved);
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]!;
          if (p.parent !== partName || p.name === partName) continue;
          const cp = p.position ?? [0, 0, 0];
          parts[i] = {
            ...p,
            position: [
              round3(cp[0] - delta[0]),
              round3(cp[1] - delta[1]),
              round3(cp[2] - delta[2]),
            ],
          };
        }
        const nextManifest: Manifest = { ...m, parts };
        return { ...current, source: withManifest(nextSrc, nextManifest) };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Pivot rotate commit — writes the geometry-side pivot.rot (§7.7
  // q_pivot; the gizmo factored the manifest rotation out upstream).
  // All-zero drops the optional rot.
  const handleGizmoRotatePivot = useCallback(
    (partName: string, rot: [number, number, number]) => {
      mutateGeometryPart(null, partName, (p) => {
        if (rot.every((v) => v === 0)) {
          const { rot: _drop, ...pivRest } = p.pivot;
          return { ...p, pivot: pivRest };
        }
        return {
          ...p,
          pivot: { ...p.pivot, rot: { x: rot[0], y: rot[1], z: rot[2] } },
        };
      });
    },
    [mutateGeometryPart],
  );

  // One completed voxel-tool stroke (design §2.6) — every painted /
  // erased / attached cell of the drag lands as ONE geometry edit =
  // one undo. The grid is then FITTED to the result's solid cells
  // (§2.7): attach grows it, erase shrinks it, and pre-existing empty
  // margins (lint W04) heal along the way. Either direction shifts
  // voxels, pivot.pos and every socket.pos together — the render is
  // unchanged because the −pivot draw offset cancels the shift exactly
  // (no manifest compensation needed). The geometry view, which draws raw
  // coordinates, re-origins once at commit.
  const handleStrokeVoxels = useCallback(
    (partName: string, edits: readonly VoxelEdit[]) => {
      if (edits.length === 0) return;
      const byKey = new Map(
        edits.map((e) => [`${e.x},${e.y},${e.z}`, e.value]),
      );
      mutateGeometryPart(null, partName, (p) => {
        const { w, h, d } = p.size;
        // Tight bounds of the result's solid cells, and whether any
        // cell actually changes.
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        let changed = false;
        const consider = (x: number, y: number, z: number) => {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        };
        for (let y = 0; y < h; y++) {
          for (let z = 0; z < d; z++) {
            for (let x = 0; x < w; x++) {
              const base = p.voxels[y]![z]![x]!;
              const nv = byKey.get(`${x},${y},${z}`);
              if (nv !== undefined && nv !== base) changed = true;
              if ((nv ?? base) !== AIR) consider(x, y, z);
            }
          }
        }
        for (const e of edits) {
          const inB =
            e.x >= 0 && e.x < w && e.y >= 0 && e.y < h && e.z >= 0 && e.z < d;
          if (inB || e.value === AIR) continue;
          changed = true;
          consider(e.x, e.y, e.z);
        }
        if (!changed) return p;
        if (minX === Infinity) {
          // Every solid cell erased — keep a 1³ empty part (W05 flags
          // it; deleting the part stays an explicit tree operation).
          // Origin unchanged, so pivot/sockets stay put.
          return { ...p, size: { w: 1, h: 1, d: 1 }, voxels: [[[AIR]]] };
        }
        const sx = -minX;
        const sy = -minY;
        const sz = -minZ;
        const nw = maxX - minX + 1;
        const nh = maxY - minY + 1;
        const nd = maxZ - minZ + 1;
        if (sx === 0 && sy === 0 && sz === 0 && nw === w && nh === h && nd === d) {
          // Bounds already tight — in-place cell edits only.
          const voxels = p.voxels.map((layer, y) =>
            layer.map((row, z) =>
              row.map((v, x) => byKey.get(`${x},${y},${z}`) ?? v),
            ),
          );
          return { ...p, voxels };
        }
        const voxels: number[][][] = [];
        for (let y = 0; y < nh; y++) {
          const layer: number[][] = [];
          for (let z = 0; z < nd; z++) {
            const row: number[] = [];
            for (let x = 0; x < nw; x++) {
              const bx = x - sx;
              const by = y - sy;
              const bz = z - sz;
              const base =
                bx >= 0 && bx < w && by >= 0 && by < h && bz >= 0 && bz < d
                  ? p.voxels[by]![bz]![bx]!
                  : AIR;
              row.push(byKey.get(`${bx},${by},${bz}`) ?? base);
            }
            layer.push(row);
          }
          voxels.push(layer);
        }
        return {
          ...p,
          size: { w: nw, h: nh, d: nd },
          voxels,
          pivot: {
            ...p.pivot,
            pos: {
              x: p.pivot.pos.x + sx,
              y: p.pivot.pos.y + sy,
              z: p.pivot.pos.z + sz,
            },
          },
          sockets: p.sockets.map((s) => ({
            ...s,
            pos: { x: s.pos.x + sx, y: s.pos.y + sy, z: s.pos.z + sz },
          })),
        };
      });
    },
    [mutateGeometryPart],
  );

  // Socket drag commits — part-local geometry edits through the shared
  // geometry mutation (one undo each).
  const handleGizmoMoveSocket = useCallback(
    (partName: string, socketName: string, pos: [number, number, number]) => {
      mutateGeometryPart(null, partName, (p) => ({
        ...p,
        sockets: p.sockets.map((s) =>
          s.name === socketName
            ? { ...s, pos: { x: pos[0], y: pos[1], z: pos[2] } }
            : s,
        ),
      }));
    },
    [mutateGeometryPart],
  );

  const handleGizmoRotateSocket = useCallback(
    (partName: string, socketName: string, rot: [number, number, number]) => {
      mutateGeometryPart(null, partName, (p) => ({
        ...p,
        sockets: p.sockets.map((s) => {
          if (s.name !== socketName) return s;
          // All-zero = identity — drop the optional rot entirely.
          if (rot.every((v) => v === 0)) {
            const { rot: _drop, ...rest } = s;
            return rest;
          }
          return { ...s, rot: { x: rot[0], y: rot[1], z: rot[2] } };
        }),
      }));
    },
    [mutateGeometryPart],
  );
  return {
    handleGizmoMovePart,
    handleGizmoRotatePart,
    handleGizmoMovePivot,
    handleGizmoRotatePivot,
    handleGizmoMoveSocket,
    handleGizmoRotateSocket,
    handleStrokeVoxels,
  };
}
