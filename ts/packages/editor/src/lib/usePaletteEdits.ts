import { useCallback } from 'react';
import { AIR, serializeColor, type Geometry, type Manifest, type Palette, type Part } from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import { geometryAt, mapGeometryFiles, modelPalette, paletteFileText, sharesPalette, withInlinePart, withManifest, writeFile } from './source-ops.js';
import type { LoadResult } from './types.js';

interface Params {
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  editsBlocked: boolean;
}

// SPEC §6.13: write the manifest's model-level palette. Mirrors the inline
// branch of a geometry file's — colors spelled out in the document that
// owns them — but the document is cuboidy.json. A palette written as a §8
// reference is handled by the same `ref` branch the file case uses, so
// only the spelled-out form lands here.
function withModelPalette(
  current: LoadResult | null,
  next: Palette,
): LoadResult | null {
  const src = current?.source;
  if (src?.manifest === undefined) return current;
  const colors = next.map(serializeColor);
  // An empty palette is spelled as an ABSENT field (§6.1), the same way a
  // geometry file omits one it does not have — so clearing every color
  // round-trips instead of leaving `"palette": []`, which the schema
  // rejects anyway.
  let manifest: Manifest;
  if (colors.length === 0) {
    const { palette: _drop, ...rest } = src.manifest;
    manifest = rest;
  } else {
    manifest = { ...src.manifest, palette: colors };
  }
  return { ...current, source: withManifest(src, manifest) };
}

export function usePaletteEdits({ dispatchEdit, editsBlocked }: Params) {
  // ── Palette editing. SPEC §7.4: a palette belongs to the document that
  // uses it — a geometry file, or (since §6.13) the manifest, for parts
  // written inline there. So every operation names its target: a path, or
  // `undefined` for the manifest. Either way the colors are spelled out in
  // that document or referenced from a shared palette file, and a
  // reference routes the write to the palette file and therefore to
  // everything sharing it.
  //
  // Still no precedence to reconcile: the manifest's palette does not
  // reach into a geometry file (§6.13), so no two of these targets can
  // claim the same part's colors. ──

  // Overwrite a palette's colors (edit / add). `file` names the geometry
  // file that owns them, or is UNDEFINED for the manifest's model-level
  // palette (SPEC §6.13) — the one an inline part draws on, and the only
  // one an all-inline model has.
  const handleEditPalette = useCallback(
    (file: string | undefined, next: Palette, tag?: string) => {
      if (editsBlocked) return;
      dispatchEdit(tag ?? null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        if (file === undefined) return withModelPalette(current, next);
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
    (file: string | undefined, index: number) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        // The manifest's palette (§6.13): scope is the inline parts that
        // fall back to it, and the same refuse-if-used rule applies.
        if (file === undefined) {
          const scope = [...src.parts].filter(
            ([name, r]) =>
              r.source === null &&
              src.manifest?.parts.find((p) => p.name === name)?.geometry
                ?.palette === undefined,
          );
          const palette = modelPalette(src);
          if (index < 0 || index >= palette.length) return current;
          for (const [, entry] of scope) {
            for (const layer of entry.part.voxels) {
              for (const row of layer) {
                if (row.includes(index)) return current;
              }
            }
          }
          let next = withModelPalette(
            current,
            palette.filter((_, i) => i !== index),
          );
          // Every higher index shifts down, so the parts drawing on this
          // palette are remapped in the SAME edit — one undo, and never a
          // frame where a voxel names the wrong color.
          for (const [name, entry] of scope) {
            const nextSrc = next?.source;
            if (nextSrc === undefined) break;
            let changed = false;
            const voxels = entry.part.voxels.map((layer: readonly (readonly number[])[]) =>
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
            if (!changed) continue;
            next = {
              ...next,
              source: withInlinePart(nextSrc, name, (p) =>
                p === undefined ? entry.part : { ...p, voxels },
              ),
            };
          }
          return next;
        }
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        const palette = geometry.palette;
        if (index < 0 || index >= palette.length) return current;
        const ref =
          geometry.paletteRef !== undefined
            ? normalizePath(geometry.paletteRef)
            : undefined;
        const inScope = (g: Geometry, path: string): boolean =>
          ref === undefined ? path === file : sharesPalette(path, g, ref);

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
        if (src === undefined) return current;
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
