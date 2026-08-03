import { useCallback, useState } from 'react';
import { AIR, duplicatePart, isIdentifier, mirrorPart, remapPartPalette, type Axis, type InlineAnimation, type Manifest, type ManifestPart, type Part, type PublishedSocket } from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import { isInlinePart, mapGeometryFiles, mergeGeometries, primaryGeometry, rewriteExternalAnims, uniquePartName, withInlinePart, withManifest } from './source-ops.js';
import type { LoadResult } from './types.js';
import { usePreviewEdits } from './usePreviewEdits.js';

// Everything that edits ONE part, plus the selection it acts on.
//
// A part straddles two files by design (SPEC §5/§6.2): its shape, pivot and
// sockets live in a geometry file, its parent and rest transform in the
// manifest. So this owns BOTH per-part mutators — mutateGeometryPart and
// mutateManifestPart — because most operations here need one or the other
// and several (the pivot gizmo above all) need both in a single undo step.

interface Params {
  loaded: LoadResult | null;
  // Latest-value ref, for handlers that must read the CURRENT document
  // without re-binding on every edit.
  loadedRef: { current: LoadResult | null };
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  editsBlocked: boolean;
  // Parenting a new part writes the manifest, so a broken manifest text
  // downgrades "create as a child" to "create at the root".
  manifestParseError: string | null;
}

// SPEC §6.12: rewrite the manifest's published sockets after something they
// point at changed name or went away. `build` returning null drops the entry.
// Key order is preserved (a publication is identified by its key, so a
// rebuild that reordered them would churn the diff for no reason), and an
// untouched manifest is returned by identity so callers can skip the write.
function mapPublishedSockets(
  m: Manifest,
  build: (target: PublishedSocket) => PublishedSocket | null,
): Manifest {
  if (m.sockets === undefined) return m;
  const next: Record<string, PublishedSocket> = {};
  let changed = false;
  for (const [pub, target] of Object.entries(m.sockets)) {
    const built = build(target);
    if (built === null) {
      changed = true;
      continue;
    }
    next[pub] = built;
    if (built !== target) changed = true;
  }
  if (!changed) return m;
  // An empty map means "publishes nothing", which the SPEC spells as an
  // absent field — writing `"sockets": {}` would be a second way to say it.
  if (Object.keys(next).length === 0) {
    const { sockets: _drop, ...rest } = m;
    return rest;
  }
  return { ...m, sockets: next };
}

// Set `sockets`, keeping SPEC §6.1's field order (before `animations`) even
// when the field is being ADDED — a bare spread would append it after the
// animations block. Same tidy-diff reason handleChangeModelVersion re-seats
// `version`. A key that already exists keeps its place under a spread, so
// this only matters for the first publication.
function withSockets(
  m: Manifest,
  sockets: Record<string, PublishedSocket>,
): Manifest {
  const { animations, ...rest } = m;
  return animations === undefined
    ? { ...rest, sockets }
    : { ...rest, sockets, animations };
}

// The published name a given (part, socket) currently goes by, or null.
// A socket MAY be published under several names (§6.12); the inspector's
// one field manages the FIRST, and leaves any others to the source view.
function publishedNameOf(
  m: Manifest | undefined,
  part: string,
  socket: string,
): string | null {
  for (const [pub, t] of Object.entries(m?.sockets ?? {})) {
    if (t.part === part && t.socket === socket) return pub;
  }
  return null;
}

export function usePartEdits({
  loaded,
  loadedRef,
  dispatchEdit,
  editsBlocked,
  manifestParseError,
}: Params) {
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(new Set());
  // Selected part for the inspector. Null = nothing selected. Pruned at
  // render time (by the caller) if the name no longer exists, so a stale
  // selection after a source edit never reaches a panel.
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);
  // In-progress "new part" draft: non-null while the tree shows the inline
  // name field. `parent` is the part it will be nested under (null = root).
  const [creating, setCreating] = useState<{ parent: string | null } | null>(
    null,
  );

  const handleToggle = useCallback((name: string) => {
    setHiddenParts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => setHiddenParts(new Set()), []);

  const handleHideAll = useCallback(() => {
    const src = loaded?.source;
    if (src !== undefined) {
      setHiddenParts(new Set(mergeGeometries(src).parts.map((p) => p.name)));
    }
  }, [loaded]);

  // Clear per-part UI state on load / reset.
  const resetPartState = useCallback(() => {
    setHiddenParts(new Set());
    setSelectedPartName(null);
    setCreating(null);
  }, []);

  // Rewrite ONE part's geometry (pivot / sockets), routed to whichever
  // geometry file defines it — part names are unique model-wide (§5), so the
  // build runs on exactly one file. `build` returning the same part is a
  // no-op (mapGeometryFiles then returns the source unchanged, and the
  // history reducer drops the entry). Backs PartProperties' Geometry section.
  const mutateGeometryPart = useCallback(
    (tag: string | null, partName: string, build: (part: Part) => Part) => {
      if (editsBlocked) return;
      dispatchEdit(tag, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        // SPEC §6.13: the shape may be in a geometry file or in the
        // manifest. This is the one place per-part geometry edits pass
        // through — the inspector, the pivot gizmo and the voxel tools all
        // funnel here — so routing it once is what keeps every one of them
        // working on an inline part without knowing that it is one.
        if (isInlinePart(src, partName)) {
          const nextSrc = withInlinePart(src, partName, (part) =>
            part === undefined ? part! : build(part),
          );
          return nextSrc === src ? current : { ...current, source: nextSrc };
        }
        const nextSrc = mapGeometryFiles(src, (geometry) => {
          const i = geometry.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const built = build(geometry.parts[i]!);
          if (built === geometry.parts[i]) return null;
          const parts = geometry.parts.slice();
          parts[i] = built;
          return { ...geometry, parts };
        });
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Adapter for PartProperties' Geometry section: (partName, build, tag?) —
  // the component supplies coalescing tags (e.g. a live pivot-axis drag) while
  // mutateGeometryPart takes the tag first.
  const handleEditPart = useCallback(
    (partName: string, build: (part: Part) => Part, tag?: string) => {
      mutateGeometryPart(tag ?? null, partName, build);
    },
    [mutateGeometryPart],
  );

  // A socket's name and its publication (SPEC §6.12) live in two files, so
  // renaming or removing one has to move both or the manifest is left
  // pointing at a socket that no longer exists — the exact cross-file
  // `missing` error §11.6 defines. Both go through ONE dispatchEdit so they
  // are one undo step, the same reason the pivot gizmo writes both files at
  // once. (Everything else about a socket — its pos and rot — is
  // geometry-only and still rides the generic onEditPart path.)
  const mutateSocket = useCallback(
    (
      partName: string,
      index: number,
      // Returns the rewritten socket, or null to delete it.
      buildSocket: (socket: Part['sockets'][number]) => Part['sockets'][number] | null,
    ) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        let oldName: string | null = null;
        let newName: string | null = null;
        const nextSrc = mapGeometryFiles(src, (geometry) => {
          const i = geometry.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const part = geometry.parts[i]!;
          const socket = part.sockets[index];
          if (socket === undefined) return null;
          const built = buildSocket(socket);
          if (built === socket) return null;
          oldName = socket.name;
          newName = built === null ? null : built.name;
          const sockets =
            built === null
              ? part.sockets.filter((_, j) => j !== index)
              : part.sockets.map((s, j) => (j === index ? built : s));
          const parts = geometry.parts.slice();
          parts[i] = { ...part, sockets };
          return { ...geometry, parts };
        });
        if (nextSrc === src || oldName === null) return current;
        if (src.manifest === undefined) {
          return { ...current, source: nextSrc };
        }
        const nextManifest = mapPublishedSockets(src.manifest, (t) =>
          t.part === partName && t.socket === oldName
            ? newName === null
              ? null
              : { ...t, socket: newName }
            : t,
        );
        return {
          ...current,
          source:
            nextManifest === src.manifest
              ? nextSrc
              : withManifest(nextSrc, nextManifest),
        };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  const handleRenameSocket = useCallback(
    (partName: string, index: number, name: string) => {
      if (!isIdentifier(name)) return;
      mutateSocket(partName, index, (s) => (s.name === name ? s : { ...s, name }));
    },
    [mutateSocket],
  );

  const handleDeleteSocket = useCallback(
    (partName: string, index: number) => {
      mutateSocket(partName, index, () => null);
    },
    [mutateSocket],
  );

  // Begin creating a part: open the inline draft row in the tree. The draft is
  // nested under the selected part when a manifest is loaded (so the new part
  // becomes its child); otherwise it goes to the root. Nothing is written until
  // the user confirms a name.
  const handleStartCreatePart = useCallback(() => {
    const src = loaded?.source;
    if (src === undefined) return;
    // Parenting writes the manifest, so it needs a clean manifest AST — with a
    // manifest syntax error, fall back to a root part (geometry only, no clobber).
    const canParent =
      src.manifest !== undefined &&
      manifestParseError === null;
    const parent =
      canParent &&
      selectedPartName !== null &&
      mergeGeometries(src).parts.some((p) => p.name === selectedPartName)
        ? selectedPartName
        : null;
    setCreating({ parent });
  }, [loaded, selectedPartName, manifestParseError]);

  const handleCancelCreatePart = useCallback(() => setCreating(null), []);

  // Append a new CONCRETE part derived from an existing one (duplicate /
  // mirror — the cuboidy-part CLI's editor twin). Geometry only, matching
  // the CLI: the new part lands in the SAME geometry file as its source and
  // gets no manifest rig entry (set parent/position afterward via the Rig
  // fields). `make` builds the part from the source + a model-wide-unique
  // name; that name is computed up front so the new part can be selected.
  const insertDerivedPart = useCallback(
    (
      sourceName: string,
      base: string,
      make: (source: Part, newName: string) => Part,
    ) => {
      if (editsBlocked) return;
      const cur = loadedRef.current?.source;
      if (cur === undefined) return;
      const merged = mergeGeometries(cur);
      const existing = new Set(merged.parts.map((p) => p.name));
      if (!existing.has(sourceName)) return;
      const newName = uniquePartName(existing, base);
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const m = mergeGeometries(src);
        const source = m.parts.find((p) => p.name === sourceName);
        if (source === undefined || m.parts.some((p) => p.name === newName)) {
          return current;
        }
        const file = m.files.get(sourceName) ?? src.primaryPath;
        const newPart = make(source, newName);
        const nextSrc = mapGeometryFiles(src, (geometry, path) =>
          path === file ? { ...geometry, parts: [...geometry.parts, newPart] } : null,
        );
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
      setSelectedPartName(newName);
    },
    [dispatchEdit, editsBlocked, loadedRef],
  );

  const handleDuplicatePart = useCallback(
    (name: string) => {
      insertDerivedPart(name, `${name}-copy`, (source, newName) =>
        duplicatePart(source, newName),
      );
    },
    [insertDerivedPart],
  );

  // Reflect the part IN PLACE (same name), a single geometry mutation — not
  // a new part. Matches `cuboidy-part mirror`.
  const handleMirrorPart = useCallback(
    (name: string, axis: Axis) => {
      mutateGeometryPart(null, name, (p) => mirrorPart(p, axis, p.name));
    },
    [mutateGeometryPart],
  );

  // Confirm the draft: append a 1×1×1 solid block (palette index 0, or AIR if
  // the palette is empty) named `name`, and — when a `parent` is given — add a
  // manifest entry parenting it there. Both files change in ONE dispatchEdit,
  // so it's a single atomic undo step. Re-guards uniqueness (the UI validates,
  // but a race could sneak a dup in). Then selects the new part.
  const handleConfirmCreatePart = useCallback(
    (name: string, parent: string | null, file?: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Uniqueness is model-wide (§5): guard against a name defined in
        // ANY geometry file.
        if (mergeGeometries(src).parts.some((p) => p.name === name)) {
          return current;
        }
        // Target geometry file: the draft row's picker choice, as long
        // as it's still a loaded geometry file; else the primary.
        const target =
          file !== undefined && src.geometries.has(file) === true
            ? file
            : src.primaryPath;
        const targetGeometry =
          target === undefined
            ? undefined
            : target !== src.primaryPath
              ? (src.geometries.get(target) ?? primaryGeometry(src))
              : primaryGeometry(src);
        // A model with no geometry file (§6.13, all inline) has no palette
        // in a file either — the manifest's is what its parts resolve
        // against.
        const paletteSize =
          targetGeometry?.palette.length ??
          (Array.isArray(src.manifest?.palette) ? src.manifest.palette.length : 0);
        const seed = paletteSize > 0 ? 0 : AIR;
        const newPart: Part = {
          name,
          size: { w: 1, h: 1, d: 1 },
          pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
          sockets: [],
          voxels: [[[seed]]],
        };
        // With no geometry file to put it in, the new part is written
        // inline — which keeps a single-file model a single file instead
        // of silently growing a voxels.json beside it.
        if (target === undefined) {
          if (src.manifest === undefined) return current;
          let nextSrc = withInlinePart(src, name, () => newPart);
          if (parent !== null && nextSrc.manifest !== undefined) {
            const parts = nextSrc.manifest.parts.map((p) =>
              p.name === name ? { ...p, parent } : p,
            );
            nextSrc = withManifest(nextSrc, { ...nextSrc.manifest, parts });
          }
          return { ...current, source: nextSrc };
        }
        const nextSrc = mapGeometryFiles(src, (geometry, path) =>
          path === target
            ? { ...geometry, parts: [...geometry.parts, newPart] }
            : null,
        );
        if (parent !== null && src.manifest !== undefined) {
          const parts: ManifestPart[] = [...src.manifest.parts, { name, parent }];
          const nextManifest: Manifest = { ...src.manifest, parts };
          return { ...current, source: withManifest(nextSrc, nextManifest) };
        }
        return { ...current, source: nextSrc };
      });
      setSelectedPartName(name);
      setCreating(null);
    },
    [dispatchEdit, editsBlocked],
  );

  // Move a part's declaration to another geometry file, atomically (one
  // dispatchEdit = one undo). The manifest is untouched — part names,
  // not paths, are the cross-file join key, so no references need fixing
  // up. Palette: with a manifest binding the shared palette makes indices
  // portable; WITHOUT one each file's inline palette gives them meaning,
  // so the moved voxels are remapped (missing colors appended to the
  // target palette).
  const handleMovePart = useCallback(
    (name: string, targetPath: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined || !src.geometries.has(targetPath)) {
          return current;
        }
        const fromPath = mergeGeometries(src).files.get(name);
        if (fromPath === undefined || fromPath === targetPath) return current;
        const fromGeometry =
          fromPath === src.primaryPath
            ? primaryGeometry(src)
            : src.geometries.get(fromPath);
        const toGeometry =
          targetPath === src.primaryPath
            ? primaryGeometry(src)
            : src.geometries.get(targetPath);
        if (fromGeometry === undefined || toGeometry === undefined) return current;
        // The name the part has IN THE FILE, which is not the rig's name
        // when `geometry.part` renames it (§6.13). Searching by the rig's
        // name found nothing there and the move silently did nothing.
        const sourceName = src.parts.get(name)?.source?.part ?? name;
        const part = fromGeometry.parts.find((p) => p.name === sourceName);
        if (part === undefined) return current;
        let moved = part;
        let toPalette = toGeometry.palette;
        // Color indices are portable only when both files resolve against
        // the SAME palette; otherwise the moved voxels must be remapped.
        const samePalette =
          fromGeometry.paletteRef !== undefined &&
          toGeometry.paletteRef !== undefined &&
          normalizePath(fromGeometry.paletteRef) ===
            normalizePath(toGeometry.paletteRef);
        if (!samePalette) {
          const remapped = remapPartPalette(part, fromGeometry.palette, toPalette);
          moved = remapped.part;
          toPalette = remapped.palette;
        }
        let nextSrc = mapGeometryFiles(src, (geometry, path) => {
          if (path === fromPath) {
            return {
              ...geometry,
              parts: geometry.parts.filter((p) => p.name !== sourceName),
            };
          }
          if (path === targetPath) {
            return { ...geometry, palette: toPalette, parts: [...geometry.parts, moved] };
          }
          return null;
        });
        // Any part reaching the shape by an explicit path (§6.13) has to
        // follow it to its new file, or the move leaves the manifest
        // pointing where the shape no longer is.
        if (src.manifest !== undefined) {
          let changed = false;
          const parts = src.manifest.parts.map((mp) => {
            if (mp.geometry?.path === undefined) return mp;
            if (normalizePath(mp.geometry.path) !== fromPath) return mp;
            if ((mp.geometry.part ?? mp.name) !== sourceName) return mp;
            changed = true;
            return { ...mp, geometry: { ...mp.geometry, path: targetPath } };
          });
          if (changed) {
            nextSrc = withManifest(nextSrc, { ...src.manifest, parts });
          }
        }
        return { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Rename a part everywhere it's referenced, atomically (one dispatchEdit =
  // one undo). The name is a cross-file join key, so a piecemeal rename would
  // leave dangling references. Rewrites:
  //   geometry     — the part's `name`
  //   manifest — the entry `name`, any `parent` pointing at it, and every inline
  //              animation track keyed by the old name (re-keyed, order kept)
  //   external — every resolved §6.3 animation file whose tracks key the old
  //              name (files map + externalAnims, same undo step)
  const handleRenamePart = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || !isIdentifier(newName)) return;
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Existence / collision checks are model-wide (§5) — the part may
        // live in any geometry file.
        const allParts = mergeGeometries(src).parts;
        if (!allParts.some((p) => p.name === oldName)) return current;
        if (allParts.some((p) => p.name === newName)) return current;
        let nextSrc = mapGeometryFiles(src, (geometry) => {
          let changed = false;
          const parts: Part[] = geometry.parts.map((p) => {
            if (p.name !== oldName) return p;
            changed = true;
            return { ...p, name: newName };
          });
          return changed ? { ...geometry, parts } : null;
        });
        // §6.3 external animation files reference the part by name too.
        nextSrc = rewriteExternalAnims(nextSrc, (anim) => {
          if (!Object.hasOwn(anim.parts, oldName)) return null;
          const nextTracks: InlineAnimation['parts'] = {};
          for (const [pName, track] of Object.entries(anim.parts)) {
            nextTracks[pName === oldName ? newName : pName] = track;
          }
          return { ...anim, parts: nextTracks };
        });
        if (src.manifest !== undefined) {
          const m = src.manifest;
          const nextMParts: ManifestPart[] = m.parts.map((mp) => {
            let nmp: ManifestPart = mp;
            if (nmp.name === oldName) nmp = { ...nmp, name: newName };
            if (nmp.parent === oldName) nmp = { ...nmp, parent: newName };
            return nmp;
          });
          let nextManifest: Manifest = { ...m, parts: nextMParts };
          // §6.12: a publication names its host part, so it moves too.
          nextManifest = mapPublishedSockets(nextManifest, (t) =>
            t.part === oldName ? { ...t, part: newName } : t,
          );
          if (m.animations !== undefined) {
            const rebuilt: NonNullable<Manifest['animations']> = {};
            let changed = false;
            for (const [aName, anim] of Object.entries(m.animations)) {
              if (typeof anim === 'string' || !Object.hasOwn(anim.parts, oldName)) {
                rebuilt[aName] = anim;
                continue;
              }
              const nextTracks: InlineAnimation['parts'] = {};
              for (const [pName, track] of Object.entries(anim.parts)) {
                nextTracks[pName === oldName ? newName : pName] = track;
              }
              rebuilt[aName] = { ...anim, parts: nextTracks };
              changed = true;
            }
            if (changed) nextManifest = { ...nextManifest, animations: rebuilt };
          }
          return { ...current, source: withManifest(nextSrc, nextManifest) };
        }
        return { ...current, source: nextSrc };
      });
      setSelectedPartName(newName);
      // Carry a hidden part's visibility over to the new name.
      setHiddenParts((prev) => {
        if (!prev.has(oldName)) return prev;
        const next = new Set(prev);
        next.delete(oldName);
        next.add(newName);
        return next;
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Delete a part, cleaning up its references atomically (one undo). Removes
  // the geometry part; in the manifest drops its entry, re-parents its children to
  // its own parent (grandparent, or root if none), and drops its animation
  // tracks (inline AND resolved external files). No confirmation: undo is the
  // safety net (same as clip delete).
  const handleDeletePart = useCallback(
    (name: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Model-wide check (§5): the part may live in any geometry file.
        const allParts = mergeGeometries(src).parts;
        if (!allParts.some((p) => p.name === name)) return current;
        let nextSrc = mapGeometryFiles(src, (geometry) =>
          geometry.parts.some((p) => p.name === name)
            ? { ...geometry, parts: geometry.parts.filter((p) => p.name !== name) }
            : null,
        );
        nextSrc = rewriteExternalAnims(nextSrc, (anim) => {
          if (!Object.hasOwn(anim.parts, name)) return null;
          const { [name]: _dropped, ...restTracks } = anim.parts;
          return { ...anim, parts: restTracks };
        });
        if (src.manifest !== undefined) {
          const m = src.manifest;
          const grandparent = m.parts.find((mp) => mp.name === name)?.parent;
          const nextMParts: ManifestPart[] = [];
          for (const mp of m.parts) {
            if (mp.name === name) continue; // drop the deleted part's entry
            if (mp.parent === name) {
              if (grandparent !== undefined) {
                nextMParts.push({ ...mp, parent: grandparent });
              } else {
                const { parent: _drop, ...rest } = mp; // re-root
                nextMParts.push(rest);
              }
            } else {
              nextMParts.push(mp);
            }
          }
          let nextManifest: Manifest = { ...m, parts: nextMParts };
          // §6.12: the part is gone, so anything it published goes with it —
          // leaving the entry would be a cross-file error (§11.6).
          nextManifest = mapPublishedSockets(nextManifest, (t) =>
            t.part === name ? null : t,
          );
          if (m.animations !== undefined) {
            const rebuilt: NonNullable<Manifest['animations']> = {};
            let changed = false;
            for (const [aName, anim] of Object.entries(m.animations)) {
              if (typeof anim === 'string' || !Object.hasOwn(anim.parts, name)) {
                rebuilt[aName] = anim;
                continue;
              }
              const { [name]: _dropped, ...restTracks } = anim.parts;
              rebuilt[aName] = { ...anim, parts: restTracks };
              changed = true;
            }
            if (changed) nextManifest = { ...nextManifest, animations: rebuilt };
          }
          return { ...current, source: withManifest(nextSrc, nextManifest) };
        }
        return { ...current, source: nextSrc };
      });
      setSelectedPartName((prev) => (prev === name ? null : prev));
      setHiddenParts((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Single-part edits coming from PartTree (D&D parent change) and
  // PartProperties (parent dropdown, position inputs). Both funnel
  // into a small manifest mutation that ensures an entry exists for
  // the affected part, re-serializes the manifest text, and clears
  // any stale parse-error state.
  //
  // No-ops when no manifest is loaded — the UI disables both entry
  // points in that case, but the defensive guard keeps a runtime
  // error from racing source-tab edits that drop the manifest.
  const mutateManifestPart = useCallback(
    (
      tag: string | null,
      partName: string,
      build: (entry: ManifestPart) => ManifestPart,
    ) => {
      if (editsBlocked) return;
      dispatchEdit(tag, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const parts = src.manifest.parts.slice();
        const i = parts.findIndex((p) => p.name === partName);
        const base: ManifestPart = i >= 0 ? parts[i]! : { name: partName };
        const next = build(base);
        if (i >= 0) parts[i] = next;
        else parts.push(next);
        const nextManifest: Manifest = { ...src.manifest, parts };
        return { ...current, source: withManifest(src, nextManifest) };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Model-level manifest fields (name / version) — the cuboidy.json data that
  // isn't per-part. Same re-serialize + clear-error shape as mutateManifestPart
  // but rewrites the top-level object. Backs the Model panel.
  const mutateManifest = useCallback(
    (tag: string | null, build: (m: Manifest) => Manifest) => {
      if (editsBlocked) return;
      dispatchEdit(tag, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const nextManifest = build(src.manifest);
        if (nextManifest === src.manifest) return current;
        return { ...current, source: withManifest(src, nextManifest) };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  const handleChangeModelName = useCallback(
    (name: string) => {
      mutateManifest(null, (m) => (m.name === name ? m : { ...m, name }));
    },
    [mutateManifest],
  );

  const handleChangeModelVersion = useCallback(
    (version: string) => {
      mutateManifest(null, (m) => {
        const v = version.trim();
        if (v === '') {
          if (m.version === undefined) return m;
          const { version: _drop, ...rest } = m;
          return rest;
        }
        if (m.version === v) return m;
        // Keep version right after name for a tidy diff even when it was
        // absent before (a bare `{ ...m, version }` would append it last).
        const { name, version: _old, ...rest } = m;
        return { name, version: v, ...rest };
      });
    },
    [mutateManifest],
  );

  // Publish a declared socket under a model-level name, or unpublish it
  // (`publicName` null). Manifest-only: the socket itself is untouched, since
  // publication is pure aliasing (§6.12).
  const handlePublishSocket = useCallback(
    (partName: string, socketName: string, publicName: string | null) => {
      mutateManifest(null, (m) => {
        const existing = publishedNameOf(m, partName, socketName);
        if (publicName === null) {
          if (existing === null) return m;
          return mapPublishedSockets(m, (t) =>
            t.part === partName && t.socket === socketName ? null : t,
          );
        }
        if (!isIdentifier(publicName) || existing === publicName) return m;
        // Published names are object keys, so they are unique model-wide —
        // taking one already in use would silently drop the other entry.
        if (Object.hasOwn(m.sockets ?? {}, publicName)) return m;
        const target: PublishedSocket = { part: partName, socket: socketName };
        if (existing === null) {
          return withSockets(m, { ...(m.sockets ?? {}), [publicName]: target });
        }
        // Rename in place: rebuilding with the new key appended would move
        // the entry to the end of the object for a pure rename.
        const sockets: Record<string, PublishedSocket> = {};
        for (const [pub, t] of Object.entries(m.sockets ?? {})) {
          if (pub === existing) sockets[publicName] = target;
          else sockets[pub] = t;
        }
        return withSockets(m, sockets);
      });
    },
    [mutateManifest],
  );

  const handleChangePartParent = useCallback(
    (partName: string, parent: string | null) => {
      // Discrete select — always its own undo entry.
      mutateManifestPart(null, partName, (entry) => {
        if (parent === null) {
          const { parent: _drop, ...rest } = entry;
          return rest;
        }
        return { ...entry, parent };
      });
    },
    [mutateManifestPart],
  );

  const handleChangePartPosition = useCallback(
    (partName: string, axis: 0 | 1 | 2, value: number) => {
      // Live number input commits per keystroke — coalesce a burst on one
      // axis into one entry.
      mutateManifestPart(`part:pos:${partName}:${axis}`, partName, (entry) => {
        const cur = entry.position ?? [0, 0, 0];
        const next: [number, number, number] = [cur[0], cur[1], cur[2]];
        next[axis] = value;
        return { ...entry, position: next };
      });
    },
    [mutateManifestPart],
  );

  // Gizmo drags and voxel strokes (lib/usePreviewEdits). They build on the
  // two mutators above rather than owning them: the inspector uses the
  // same ones, just with different undo granularity.
  const {
    handleGizmoMovePart,
    handleGizmoRotatePart,
    handleGizmoMovePivot,
    handleGizmoRotatePivot,
    handleGizmoMoveSocket,
    handleGizmoRotateSocket,
    handleStrokeVoxels,
  } = usePreviewEdits({
    dispatchEdit,
    editsBlocked,
    mutateGeometryPart,
    mutateManifestPart,
  });

  const handleChangePartRotation = useCallback(
    (partName: string, axis: 0 | 1 | 2, value: number) => {
      mutateManifestPart(`part:rot:${partName}:${axis}`, partName, (entry) => {
        const cur = entry.rotation ?? [0, 0, 0];
        const next: [number, number, number] = [cur[0], cur[1], cur[2]];
        next[axis] = value;
        return { ...entry, rotation: next };
      });
    },
    [mutateManifestPart],
  );

  // Checkbox on/off: absent `rotation` is the SPEC default (identity), so
  // unchecking drops the field from the JSON instead of writing [0,0,0].
  const handleTogglePartRotation = useCallback(
    (partName: string, on: boolean) => {
      mutateManifestPart(null, partName, (entry) => {
        if (on) return { ...entry, rotation: entry.rotation ?? [0, 0, 0] };
        const { rotation: _drop, ...rest } = entry;
        return rest;
      });
    },
    [mutateManifestPart],
  );
  return {
    hiddenParts,
    selectedPartName,
    setSelectedPartName,
    creating,
    resetPartState,
    handleToggle,
    handleShowAll,
    handleHideAll,
    handleEditPart,
    handleStartCreatePart,
    handleCancelCreatePart,
    handleConfirmCreatePart,
    handleDuplicatePart,
    handleMirrorPart,
    handleMovePart,
    handleRenamePart,
    handleDeletePart,
    handleChangeModelName,
    handleChangeModelVersion,
    handleChangePartParent,
    handleChangePartPosition,
    handleChangePartRotation,
    handleTogglePartRotation,
    handleRenameSocket,
    handleDeleteSocket,
    handlePublishSocket,
    handleGizmoMovePart,
    handleGizmoRotatePart,
    handleGizmoMovePivot,
    handleGizmoRotatePivot,
    handleGizmoMoveSocket,
    handleGizmoRotateSocket,
    handleStrokeVoxels,
  };
}
