import { useCallback } from 'react';
import { addAttrAtTime, deleteAttrAtKey, isIdentifier, mergeKeyframeAtTime, moveAttrKey, setAttrAtKey, setEaseAtKey, trimTrackKeys, type AttrValue, type EaseAttr, type EasingName, type InlineAnimation, type KeyAttr, type Keyframe, type Manifest } from '@cuboidy/core';
import { withManifest, writeFile } from './source-ops.js';
import type { LoadResult } from './types.js';
import { useSourceMutations } from './useSourceMutations.js';

// Every edit the keyframe editor can make, in one place. They all funnel
// through mutateManifestAnimation, which is the interesting part: a clip
// is either an inline object in cuboidy.json or a §6.3 reference to its
// own file, and the write has to land wherever that clip actually lives.
// Callers never need to know which.

interface Params {
  // The recorded-edit dispatcher; `tag` coalesces a burst into one entry.
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  // Some file's source text is mid-edit unparseable, so re-serializing an
  // AST over it would discard what the user typed (audit A-6).
  editsBlocked: boolean;
  // Creating a clip switches the editor to the anim view. That is layout
  // state, which lives in App — and it must happen OUTSIDE the reducer.
  onClipCreated: () => void;
}

export function useAnimationEdits({
  dispatchEdit,
  editsBlocked,
  onClipCreated,
}: Params) {
  const { mutateSource, mutateManifest } = useSourceMutations({
    dispatchEdit,
    editsBlocked,
  });

  // ─── Animation (keyframe editor) edits ──────────────────────────────
  //
  // The `animations` analog of mutateManifestPart: immutably updates one
  // clip and routes the write to where the clip LIVES — an inline object
  // goes back into the manifest (text kept in sync); a §6.3 string ref
  // goes into the referenced external file (files map + externalAnims),
  // leaving the manifest untouched. No-ops on an unresolved ref (load
  // error) or when no manifest is loaded.
  const mutateManifestAnimation = useCallback(
    (
      tag: string | null,
      animName: string,
      build: (anim: InlineAnimation) => InlineAnimation,
    ) => {
      mutateSource(tag, (src) => {
        if (src.manifest === undefined) return null;
        const prev = src.manifest.animations?.[animName];
        if (prev === undefined) return null;
        if (typeof prev === 'string') {
          const rec = src.externalAnims?.get(animName);
          if (rec === undefined) return null; // unresolved ref
          const built = build(rec.anim);
          if (built === rec.anim) return null;
          const externalAnims = new Map(src.externalAnims);
          externalAnims.set(animName, { path: rec.path, anim: built });
          return {
            ...writeFile(src, rec.path, JSON.stringify(built, null, 2) + '\n'),
            externalAnims,
          };
        }
        const built = build(prev);
        if (built === prev) return null;
        const animations = { ...src.manifest.animations, [animName]: built };
        return withManifest(src, { ...src.manifest, animations });
      });
    },
    [mutateSource],
  );

  // Overwrite an existing key's attribute value. Vec3 fields commit per
  // keystroke (live NumberInput) — coalesce per key+attr; the visible
  // checkbox is discrete and always pushes.
  const handleSetAnimField = useCallback(
    (
      animName: string,
      part: string,
      timeKey: string,
      attr: KeyAttr,
      value: AttrValue,
    ) => {
      const tag =
        attr === 'visible'
          ? null
          : `anim:set:${animName}:${part}:${timeKey}:${attr}`;
      mutateManifestAnimation(tag, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined || track[timeKey] === undefined) return anim;
        return {
          ...anim,
          parts: { ...anim.parts, [part]: setAttrAtKey(track, timeKey, attr, value) },
        };
      });
    },
    [mutateManifestAnimation],
  );

  // Set or clear (undefined) one attribute's ease at an existing key.
  // Discrete dropdown change — always its own undo entry (tag null).
  const handleSetAnimEase = useCallback(
    (
      animName: string,
      part: string,
      timeKey: string,
      attr: EaseAttr,
      ease: EasingName | undefined,
    ) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined) return anim;
        const nextTrack = setEaseAtKey(track, timeKey, attr, ease);
        if (nextTrack === track) return anim;
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Add (or merge) a key for `attr` at `time`; the helper seeds the §6.6 0.0
  // key and creates the part's track if absent.
  const handleAddAnimKey = useCallback(
    (animName: string, part: string, time: number, attr: KeyAttr, value: AttrValue) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part] ?? {};
        const { track: nextTrack } = addAttrAtTime(track, time, attr, value);
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Remove one attribute key; prune the part's track if it becomes empty.
  const handleDeleteAnimKey = useCallback(
    (animName: string, part: string, timeKey: string, attr: KeyAttr) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined) return anim;
        const nextTrack = deleteAttrAtKey(track, timeKey, attr);
        const parts = { ...anim.parts };
        if (Object.keys(nextTrack).length === 0) delete parts[part];
        else parts[part] = nextTrack;
        return { ...anim, parts };
      });
    },
    [mutateManifestAnimation],
  );

  // Paste a copied keyframe: field-wise merge at `time` on `part`. One
  // discrete undo entry per paste (tag null).
  const handlePasteAnimKeyframe = useCallback(
    (animName: string, part: string, time: number, kf: Keyframe) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part] ?? {};
        const { track: nextTrack } = mergeKeyframeAtTime(track, time, kf);
        if (nextTrack === track) return anim;
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Retime one attribute key (timeline marker drag). The helper is a pure
  // rename; same-attr collisions are blocked by the drag clamp in the UI.
  const handleMoveAnimKey = useCallback(
    (
      animName: string,
      part: string,
      fromTimeKey: string,
      toTime: number,
      attr: KeyAttr,
    ) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined) return anim;
        const { track: nextTrack } = moveAttrKey(track, fromTimeKey, toTime, attr);
        if (nextTrack === track) return anim;
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Drop every key beyond the clip's duration (the lint badge's Trim action).
  // Parts whose track empties out are removed entirely.
  const handleTrimClip = useCallback(
    (animName: string) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const parts: InlineAnimation['parts'] = {};
        for (const [name, track] of Object.entries(anim.parts)) {
          const trimmed = trimTrackKeys(track, anim.duration);
          if (Object.keys(trimmed).length > 0) parts[name] = trimmed;
        }
        return { ...anim, parts };
      });
    },
    [mutateManifestAnimation],
  );

  const handleSetClipDuration = useCallback(
    (animName: string, duration: number) => {
      // Live number input — coalesce a typing burst into one entry.
      mutateManifestAnimation(`anim:duration:${animName}`, animName, (anim) => ({
        ...anim,
        duration,
      }));
    },
    [mutateManifestAnimation],
  );

  const handleSetClipLoop = useCallback(
    (animName: string, loop: boolean) => {
      mutateManifestAnimation(null, animName, (anim) => ({ ...anim, loop }));
    },
    [mutateManifestAnimation],
  );

  // Seed a new empty inline clip (unique identifier-safe name) and switch to
  // the anim view. Can't go through mutateManifestAnimation since the entry
  // doesn't exist yet.
  const handleCreateAnimationClip = useCallback(() => {
    // Gated here, not just inside mutateManifest: the view switch below
    // must not run either when edits are blocked.
    if (editsBlocked) return;
    mutateManifest(null, (m) => {
      const existing = m.animations ?? {};
      let n = 1;
      let name = `clip${n}`;
      while (existing[name] !== undefined) {
        n += 1;
        name = `clip${n}`;
      }
      const newClip: InlineAnimation = { duration: 1, loop: true, parts: {} };
      return { ...m, animations: { ...existing, [name]: newClip } };
    });
    // Outside the apply closure: reducer appliers must stay pure, and
    // StrictMode double-invokes them.
    onClipCreated();
  }, [editsBlocked, mutateManifest, onClipCreated]);

  // Rename a clip, preserving its position in the animations map (rebuild
  // entries in insertion order, swapping the key) so the JSON diff is one
  // line. Collision checks use Object.hasOwn — `animations['constructor']`
  // would be truthy via the prototype chain — and run against ALL keys
  // (string-ref animations included).
  const handleRenameClip = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || !isIdentifier(newName)) return;
      mutateSource(null, (src) => {
        if (src.manifest === undefined) return null;
        const animations = src.manifest.animations;
        if (animations === undefined || !Object.hasOwn(animations, oldName)) {
          return null;
        }
        if (Object.hasOwn(animations, newName)) return null;
        const next: NonNullable<Manifest['animations']> = {};
        for (const [k, v] of Object.entries(animations)) {
          next[k === oldName ? newName : k] = v;
        }
        const nextManifest: Manifest = { ...src.manifest, animations: next };
        // An external clip's resolution is keyed by clip name — re-key it
        // (the referenced file itself is untouched by a clip rename).
        let externalAnims = src.externalAnims;
        const ext = externalAnims?.get(oldName);
        if (externalAnims !== undefined && ext !== undefined) {
          const rebuilt = new Map(externalAnims);
          rebuilt.delete(oldName);
          rebuilt.set(newName, ext);
          externalAnims = rebuilt;
        }
        return {
          ...withManifest(src, nextManifest),
          ...(externalAnims !== undefined && { externalAnims }),
        };
      });
    },
    [mutateSource],
  );

  // Delete a clip. No confirmation — undo is the safety net. Deleting the
  // last clip drops the `animations` property entirely (SPEC: absent → no
  // animations; cleaner authored JSON).
  const handleDeleteClip = useCallback(
    (name: string) => {
      mutateSource(null, (src) => {
        if (src.manifest === undefined) return null;
        const animations = src.manifest.animations;
        if (animations === undefined || !Object.hasOwn(animations, name)) {
          return null;
        }
        const { [name]: _dropped, ...rest } = animations;
        let nextManifest: Manifest;
        if (Object.keys(rest).length === 0) {
          const { animations: _all, ...m } = src.manifest;
          nextManifest = m;
        } else {
          nextManifest = { ...src.manifest, animations: rest };
        }
        // Deleting an external clip removes the manifest entry only; the
        // referenced file stays (it may be shared — delete it from the
        // Files tree if it's truly orphaned).
        let externalAnims = src.externalAnims;
        if (externalAnims?.has(name) === true) {
          const rebuilt = new Map(externalAnims);
          rebuilt.delete(name);
          externalAnims = rebuilt;
        }
        return {
          ...withManifest(src, nextManifest),
          ...(externalAnims !== undefined && { externalAnims }),
        };
      });
    },
    [mutateSource],
  );

  // Move an inline clip out to its own file (§6.3): write
  // `anims/<name>.json` (unique-suffixed if taken) and swap the manifest
  // value to the reference path. One dispatchEdit = one undo.
  const handleExternalizeClip = useCallback(
    (name: string) => {
      mutateSource(null, (src) => {
        if (src.manifest === undefined) return null;
        const anim = src.manifest.animations?.[name];
        if (anim === undefined || typeof anim === 'string') return null;
        let path = `anims/${name}.json`;
        let n = 2;
        while (src.files.has(path)) path = `anims/${name}-${n++}.json`;
        // Write the clip's file first, then point the manifest at it: the
        // manifest write resolves the reference, which is what fills in the
        // record the timeline writes through.
        const withClipFile = writeFile(
          src,
          path,
          JSON.stringify(anim, null, 2) + '\n',
        );
        const animations = { ...src.manifest.animations, [name]: path };
        return withManifest(withClipFile, { ...src.manifest, animations });
      });
    },
    [mutateSource],
  );

  // The reverse: copy an external clip's object back into the manifest.
  // The referenced file is kept (it may be shared) — it just becomes
  // unreferenced; delete it from the Files tree if it's orphaned.
  const handleInlineClip = useCallback(
    (name: string) => {
      mutateManifest(null, (m, src) => {
        const ref = m.animations?.[name];
        if (typeof ref !== 'string') return null;
        const rec = src.externalAnims?.get(name);
        if (rec === undefined) return null; // unresolved ref
        return { ...m, animations: { ...m.animations, [name]: rec.anim } };
      });
    },
    [mutateManifest],
  );

  // Remove a part's whole track from a clip (the timeline's per-part ×).
  const handleClearPartTrack = useCallback(
    (animName: string, part: string) => {
      mutateManifestAnimation(null, animName, (anim) => {
        if (anim.parts[part] === undefined) return anim;
        const { [part]: _dropped, ...parts } = anim.parts;
        return { ...anim, parts };
      });
    },
    [mutateManifestAnimation],
  );
  return {
    handleSetAnimField,
    handleSetAnimEase,
    handleAddAnimKey,
    handleDeleteAnimKey,
    handlePasteAnimKeyframe,
    handleMoveAnimKey,
    handleTrimClip,
    handleSetClipDuration,
    handleSetClipLoop,
    handleCreateAnimationClip,
    handleRenameClip,
    handleDeleteClip,
    handleExternalizeClip,
    handleInlineClip,
    handleClearPartTrack,
  };
}
