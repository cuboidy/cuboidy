import type { Geometry, Manifest, Palette, Part } from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import { geometryAt, modelPalette, primaryGeometry, sharesPalette } from './source-ops.js';
import type { LoadedSource } from './types.js';

// Pure derivations of what the panels render, out of App so each is a
// testable function of LoadedSource rather than a memo body. App keeps
// thin useMemos over these.

// The animation-facing manifest: §6.3 string refs replaced by their
// resolved external clips, so the session / viewport / timeline treat
// every clip uniformly. Unresolved refs (load errors) stay strings and
// are filtered out downstream as before.
export function animManifestOf(src: LoadedSource): Manifest | undefined {
  if (src.manifest === undefined) return undefined;
  const m = src.manifest;
  if (m.animations === undefined || src.externalAnims === undefined) {
    return m;
  }
  let changed = false;
  const animations: NonNullable<Manifest['animations']> = {};
  for (const [name, anim] of Object.entries(m.animations)) {
    const ext =
      typeof anim === 'string' ? src.externalAnims.get(name) : undefined;
    if (ext !== undefined) {
      animations[name] = ext.anim;
      changed = true;
    } else {
      animations[name] = anim;
    }
  }
  return changed ? { ...m, animations } : m;
}

// Clip name → external file path, for the timeline's storage label and
// the Externalize / Inline toggle.
export function clipRefsOf(src: LoadedSource): Map<string, string> {
  const m = new Map<string, string>();
  if (src.manifest?.animations !== undefined) {
    for (const [name, anim] of Object.entries(src.manifest.animations)) {
      if (typeof anim === 'string') m.set(name, normalizePath(anim));
    }
  }
  return m;
}

// Per-part render palettes (SPEC §7.4 / §6.13): every part resolves
// against its own source's colors — its defining file's, or, for a part
// written inline in the manifest, whatever §6.13 resolved for it.
//
// Undefined when the parts CANNOT disagree: one geometry file and
// nothing inline, where the model palette already covers everything. Any
// inline part makes the map necessary even in a one-file model, because
// it takes its colors from the manifest rather than from that file.
export function partPalettesOf(
  src: LoadedSource,
): Map<string, Palette> | undefined {
  const inlineCount = [...src.parts.values()].filter(
    (r) => r.source === null,
  ).length;
  if (src.geometries.size <= 1 && inlineCount === 0) {
    return undefined;
  }
  const m = new Map<string, Palette>();
  for (const [path, g] of src.geometries) {
    const geometry =
      path === src.primaryPath ? (primaryGeometry(src) ?? g) : g;
    for (const part of geometry.parts) {
      if (!m.has(part.name)) m.set(part.name, geometry.palette);
    }
  }
  // Every resolved part's own colors win: a file-backed one takes its
  // file's, an inline one whatever §6.13 resolved for it.
  for (const [name, r] of src.parts) m.set(name, r.palette);
  return m;
}

// What the Palette panel is pointed at: one geometry file, its resolved
// colors, and — when those colors live in a shared palette file — the
// path they came from.
export interface PaletteTargetInfo {
  // The geometry file whose palette this is. ABSENT means the MANIFEST's
  // model-level palette (SPEC §6.13) — what a part written inline draws
  // on, and the only palette an all-inline model has.
  file?: string;
  palette: Palette;
  // The parts whose voxels resolve against this palette, for usage counts.
  scopeParts: readonly Part[];
  // The palette is referenced but the referenced file did not load.
  unresolved: boolean;
  ref?: string;
}

// What the Palette panel edits (§7.4): the palette of the geometry file
// that DEFINES the selected part — pick a part, edit its colors. With no
// selection it falls back to the primary file. `ref` is set when those
// colors live in a shared palette file, which is what the panel reports
// and what Inline / Externalize toggle.
export function paletteTargetOf(
  src: LoadedSource,
  selectedPart: string | null,
  partFiles: ReadonlyMap<string, string> | undefined,
  mergedParts: readonly Part[] | undefined,
): PaletteTargetInfo {
  const file =
    (selectedPart !== null ? partFiles?.get(selectedPart) : undefined) ??
    src.primaryPath;
  // SPEC §6.13: a part written inline has no defining file, so its
  // colors are the MANIFEST's — `file: undefined` is that target, and
  // the palette panel edits `cuboidy.json` instead of a geometry file.
  // (`partFiles` deliberately omits inline parts for this reason.)
  const geometry = file === undefined ? undefined : geometryAt(src, file);
  if (geometry === undefined) {
    const modelRef =
      typeof src.manifest?.palette === 'string'
        ? normalizePath(src.manifest.palette)
        : undefined;
    const palette = modelPalette(src);
    return {
      palette,
      // Every inline part that did not declare colors of its own draws
      // on this one, so those are its usage scope.
      scopeParts: [...src.parts.values()]
        .filter((r) => r.source === null)
        .map((r) => r.part),
      unresolved: modelRef !== undefined && palette.length === 0,
      ...(modelRef !== undefined && { ref: modelRef }),
    };
  }
  const ref =
    geometry.paletteRef === undefined
      ? undefined
      : normalizePath(geometry.paletteRef);
  // Usage counts span every file resolving against THIS palette: a shared
  // one covers all its referrers, an inline one only its own file.
  const scopeParts =
    ref === undefined
      ? geometry.parts
      : (mergedParts ?? geometry.parts).filter((part) => {
          const at = partFiles?.get(part.name) ?? '';
          const g = geometryAt(src, at);
          return g !== undefined && sharesPalette(at, g, ref);
        });
  return {
    ...(file !== undefined && { file }),
    palette: geometry.palette,
    scopeParts,
    // A reference that did not resolve shows an empty palette plus a
    // reason, rather than pretending the file declares no colors.
    unresolved: ref !== undefined && geometry.palette.length === 0,
    ...(ref !== undefined && { ref }),
  };
}

// The whole model as one Geometry view — every geometry file's parts
// plus every part written inline (SPEC §6.13), over the model palette.
export function modelGeometryOf(
  src: LoadedSource,
  mergedParts: readonly Part[],
): Geometry {
  return { palette: modelPalette(src), parts: mergedParts as Part[] };
}
