import { useCallback, useState } from 'react';
import {
  AIR,
  composePartRotation,
  duplicatePart,
  isIdentifier,
  mirrorPart,
  quatRotateVec3,
  type Axis,
  type InlineAnimation,
  type Manifest,
  type ManifestPart,
  type Part,
} from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import {
  mapGeometryFiles,
  mergeGeometries,
  primaryGeometry,
  remapPartPalette,
  rewriteExternalAnims,
  uniquePartName,
  withManifest,
} from './source-ops.js';
import type { LoadResult, VoxelEdit } from './types.js';

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
          file !== undefined &&
          src.geometries.has(file) === true
            ? file
            : src.primaryPath;
        const targetGeometry =
          target !== src.primaryPath
            ? (src.geometries.get(target) ?? primaryGeometry(src))
            : primaryGeometry(src);
        const seed = targetGeometry.palette.length > 0 ? 0 : AIR;
        const newPart: Part = {
          name,
          size: { w: 1, h: 1, d: 1 },
          pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
          sockets: [],
          voxels: [[[seed]]],
        };
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
        if (
          src === undefined ||
          src.geometries === undefined ||
          !src.geometries.has(targetPath)
        ) {
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
        const part = fromGeometry.parts.find((p) => p.name === name);
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
        const nextSrc = mapGeometryFiles(src, (geometry, path) => {
          if (path === fromPath) {
            return { ...geometry, parts: geometry.parts.filter((p) => p.name !== name) };
          }
          if (path === targetPath) {
            return { ...geometry, palette: toPalette, parts: [...geometry.parts, moved] };
          }
          return null;
        });
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
    mutateManifest,
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
    handleGizmoMovePart,
    handleGizmoRotatePart,
    handleGizmoMovePivot,
    handleGizmoRotatePivot,
    handleGizmoMoveSocket,
    handleGizmoRotateSocket,
    handleStrokeVoxels,
  };
}
