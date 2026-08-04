import { useCallback } from 'react';
import { AIR, type Geometry, type Palette, type Part } from '@cuboidy/core';
import { normalizePath, withResolvedPalette } from './load-model.js';
import { freePalettePath, geometryAt, mapGeometryFiles, paletteFileText, relativeRefFrom, resolvedModelPalette, sharesPalette, withInlinePart, withManifest, withModelPalette, writeFile, writeModelPalette } from './source-ops.js';
import type { LoadResult, LoadedSource } from './types.js';
import { useSourceMutations } from './useSourceMutations.js';

interface Params {
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  editsBlocked: boolean;
}

export function usePaletteEdits({ dispatchEdit, editsBlocked }: Params) {
  const { mutateSource } = useSourceMutations({ dispatchEdit, editsBlocked });

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
      mutateSource(tag ?? null, (src) => {
        if (file === undefined) return writeModelPalette(src, next);
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return null;
        if (geometry.paletteRef === undefined) {
          return mapGeometryFiles(src, (g, path) =>
            path === file ? { ...g, palette: next } : null,
          );
        }
        // Referenced: the palette FILE is the source of truth. Writing it
        // re-resolves the colors into every geometry pointing at it, so
        // the 3D view updates without a reload.
        const ref = normalizePath(geometry.paletteRef);
        return writeFile(src, ref, paletteFileText(next));
      });
    },
    [mutateSource],
  );

  // Delete an (unused) color: every higher index shifts down, so the voxels
  // of every file resolving against this palette are remapped in the SAME
  // edit — a shared palette means all its referrers, an inline one only its
  // own file. Refuses while any in-scope voxel still uses the color.
  const handleDeletePaletteColor = useCallback(
    (file: string | undefined, index: number) => {
      mutateSource(null, (src) => {
        // The manifest's palette (§6.13): scope is the inline parts that
        // fall back to it, and the same refuse-if-used rule applies.
        if (file === undefined) {
          const scope = [...src.parts].filter(
            ([name, r]) =>
              r.source === null &&
              src.manifest?.parts.find((p) => p.name === name)?.geometry
                ?.palette === undefined,
          );
          const palette = resolvedModelPalette(src);
          if (index < 0 || index >= palette.length) return null;
          for (const [, entry] of scope) {
            for (const layer of entry.part.voxels) {
              for (const row of layer) {
                if (row.includes(index)) return null;
              }
            }
          }
          let next = writeModelPalette(
            src,
            palette.filter((_, i) => i !== index),
          );
          if (next === null) return null;
          // Every higher index shifts down, so the parts drawing on this
          // palette are remapped in the SAME edit — one undo, and never a
          // frame where a voxel names the wrong color.
          for (const [name, entry] of scope) {
            let changed = false;
            const voxels = entry.part.voxels.map(
              (layer: readonly (readonly number[])[]) =>
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
            next = withInlinePart(next, name, (p) =>
              p === undefined ? entry.part : { ...p, voxels },
            );
          }
          return next;
        }
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return null;
        const palette = geometry.palette;
        if (index < 0 || index >= palette.length) return null;
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
                if (row.includes(index)) return null;
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
        if (ref === undefined) return nextSrc;
        return writeFile(nextSrc, ref, paletteFileText(nextPalette));
      });
    },
    [mutateSource],
  );

  // Move this palette out to a NEW palette file and point at it. The
  // colors are unchanged — only where they live. One undo.
  //
  // `file` undefined is the manifest's model-level palette (§6.1), which
  // takes a reference exactly as a geometry file's does. It used to be
  // excluded, which left an all-inline model unable to share its colors
  // at all — and made "where does this palette live?" a question with
  // one answer for some targets and three for others.
  const handleExternalizePalette = useCallback(
    (file: string | undefined) => {
      mutateSource(null, (src) => {
        if (file === undefined) {
          if (src.manifest === undefined) return null;
          if (typeof src.manifest.palette === 'string') return null;
          const palette = resolvedModelPalette(src);
          if (palette.length === 0) return null;
          const path = freePalettePath(src);
          const withFile = writeFile(src, path, paletteFileText(palette));
          return withManifest(withFile, { ...src.manifest, palette: path });
        }
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return null;
        if (geometry.paletteRef !== undefined) return null;
        if (geometry.palette.length === 0) return null;
        const path = freePalettePath(src);
        const nextSrc = mapGeometryFiles(src, (g, at) =>
          at === file ? { ...g, paletteRef: path } : null,
        );
        return writeFile(nextSrc, path, paletteFileText(geometry.palette));
      });
    },
    [mutateSource],
  );

  // The reverse: keep the colors, drop the reference so they are written
  // into the document itself. The palette file stays (it may be shared)
  // — delete it from the Files tree if it is truly orphaned.
  const handleInlinePalette = useCallback(
    (file: string | undefined) => {
      mutateSource(null, (src) => {
        if (file === undefined) {
          if (src.manifest === undefined) return null;
          if (typeof src.manifest.palette !== 'string') return null;
          const palette = resolvedModelPalette(src);
          // An unresolved reference has no colors to keep; inlining it
          // would silently empty the palette rather than rescue it.
          if (palette.length === 0) return null;
          return withModelPalette(src, palette);
        }
        if (geometryAt(src, file)?.paletteRef === undefined) return null;
        return mapGeometryFiles(src, (g, path) => {
          if (path !== file) return null;
          const { paletteRef: _drop, ...rest } = g;
          return rest;
        });
      });
    },
    [mutateSource],
  );
  // Point this palette at an EXISTING palette file — the third storage
  // move, beside Externalize (colors out to a NEW file) and Inline (a
  // file's colors back into the document). It is what "use the palette
  // I already have" means, and it lives HERE rather than on a file-tree
  // row because §7.4 binds a palette to the document that uses it: this
  // panel is the one place that knows which document that is, so there
  // is no target to guess.
  //
  // `ref` is package-relative; a geometry file records it relative to
  // ITSELF (§8). The colors become the target's — voxel indices keep
  // their numbers and take on new meanings, which is the point of
  // sharing a palette rather than copying it.
  const handleUsePaletteFile = useCallback(
    (file: string | undefined, ref: string) => {
      mutateSource(null, (src) => {
        const target = normalizePath(ref);
        if (!src.files.has(target)) return null;
        if (file === undefined) {
          // The manifest's model-level palette (§6.1) takes the same two
          // forms a geometry file's does, so pointing it at a file is
          // simply the string form. withManifest re-resolves, which is
          // what carries the new colors to the inline parts.
          if (src.manifest === undefined) return null;
          if (src.manifest.palette === target) return null;
          return withManifest(src, { ...src.manifest, palette: target });
        }
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return null;
        const written = relativeRefFrom(file, target);
        if (geometry.paletteRef === written) return null;
        // Resolve in the same step: the AST carries the colors it now
        // renders, while the re-serialized text carries the reference.
        return mapGeometryFiles(src, (g, path) =>
          path === file
            ? withResolvedPalette(
                { ...g, paletteRef: written },
                (p) => src.files.get(p),
                file,
              )
            : null,
        );
      });
    },
    [mutateSource],
  );

  return {
    handleEditPalette,
    handleDeletePaletteColor,
    handleExternalizePalette,
    handleInlinePalette,
    handleUsePaletteFile,
  };
}
