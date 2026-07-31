import { useCallback } from 'react';
import { AIR, type Geometry, type Palette, type Part } from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import {
  geometryAt,
  mapGeometryFiles,
  paletteFileText,
  sharesPalette,
  writeFile,
} from './source-ops.js';
import type { LoadResult } from './types.js';

interface Params {
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  editsBlocked: boolean;
}

export function usePaletteEdits({ dispatchEdit, editsBlocked }: Params) {
  // ── Palette editing. SPEC §7.4: a palette belongs to a GEOMETRY FILE,
  // either spelled out inline or referenced from a shared palette file. So
  // every operation here names the file it acts on — the panel picks that
  // from the selected part. A reference routes the write to the palette
  // file, and therefore to every geometry file sharing it; an inline
  // palette is rewritten in place. There is no model-wide palette and no
  // precedence rule left to reconcile. ──

  // Overwrite a file's palette colors (edit / add).
  const handleEditPalette = useCallback(
    (file: string, next: Palette, tag?: string) => {
      if (editsBlocked) return;
      dispatchEdit(tag ?? null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        if (geometry.paletteRef === undefined) {
          const nextSrc = mapGeometryFiles(src, (g, path) =>
            path === file ? { ...g, palette: next } : null,
          );
          return nextSrc === src ? current : { ...current, source: nextSrc };
        }
        // Referenced: the palette FILE is the source of truth. Refresh the
        // resolved copy on every geometry pointing at it so the 3D view
        // updates without a reload.
        // Writing the palette FILE re-resolves it into every geometry that
        // points at it, so the 3D view updates without a reload.
        const ref = normalizePath(geometry.paletteRef);
        return {
          ...current,
          source: writeFile(src, ref, paletteFileText(next)),
        };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Delete an (unused) color: every higher index shifts down, so the voxels
  // of every file resolving against this palette are remapped in the SAME
  // edit — a shared palette means all its referrers, an inline one only its
  // own file. Refuses while any in-scope voxel still uses the color.
  const handleDeletePaletteColor = useCallback(
    (file: string, index: number) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        const palette = geometry.palette;
        if (index < 0 || index >= palette.length) return current;
        const ref =
          geometry.paletteRef !== undefined
            ? normalizePath(geometry.paletteRef)
            : undefined;
        const inScope = (g: Geometry, path: string): boolean =>
          ref === undefined ? path === file : sharesPalette(g, ref);

        for (const [path, g] of src.geometries) {
          if (!inScope(g, path)) continue;
          for (const part of g.parts) {
            for (const layer of part.voxels) {
              for (const row of layer) {
                if (row.includes(index)) return current;
              }
            }
          }
        }

        const nextPalette = palette.filter((_, i) => i !== index);
        const nextSrc = mapGeometryFiles(src, (g, path) => {
          if (!inScope(g, path)) return null;
          const parts: Part[] = g.parts.map((part) => {
            let changed = false;
            const voxels = part.voxels.map((layer) =>
              layer.map((row) =>
                row.map((idx) => {
                  if (idx !== AIR && idx > index) {
                    changed = true;
                    return idx - 1;
                  }
                  return idx;
                }),
              ),
            );
            return changed ? { ...part, voxels } : part;
          });
          return { ...g, parts, palette: nextPalette };
        });
        if (ref === undefined) return { ...current, source: nextSrc };
        return {
          ...current,
          source: writeFile(nextSrc, ref, paletteFileText(nextPalette)),
        };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Move ONE file's inline palette out to a palette file and point at it.
  // The colors are unchanged — only where they live. One undo.
  const handleExternalizePalette = useCallback(
    (file: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined || src.files === undefined) return current;
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        if (geometry.paletteRef !== undefined) return current;
        if (geometry.palette.length === 0) return current;
        let path = 'palette.json';
        let n = 2;
        while (src.files.has(path)) path = `palette-${n++}.json`;
        const nextSrc = mapGeometryFiles(src, (g, at) =>
          at === file ? { ...g, paletteRef: path } : null,
        );
        return {
          ...current,
          source: writeFile(nextSrc, path, paletteFileText(geometry.palette)),
        };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // The reverse: keep the colors, drop the reference so they are written
  // into the geometry file itself. The palette file stays (it may be shared)
  // — delete it from the Files tree if it is truly orphaned.
  const handleInlinePalette = useCallback(
    (file: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        if (geometryAt(src, file)?.paletteRef === undefined) return current;
        const nextSrc = mapGeometryFiles(src, (g, path) => {
          if (path !== file) return null;
          const { paletteRef: _drop, ...rest } = g;
          return rest;
        });
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, editsBlocked],
  );
  return {
    handleEditPalette,
    handleDeletePaletteColor,
    handleExternalizePalette,
    handleInlinePalette,
  };
}
