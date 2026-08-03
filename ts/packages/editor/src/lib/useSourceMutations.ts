import { useCallback } from 'react';
import type { Manifest } from '@cuboidy/core';
import { withManifest } from './source-ops.js';
import type { LoadResult, LoadedSource } from './types.js';

interface Params {
  // The recorded-edit dispatcher; `tag` coalesces a burst into one entry.
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  // Some file's source text is mid-edit unparseable, so re-serializing an
  // AST over it would discard what the user typed (audit A-6). Omitted by
  // hooks that don't gate on parse state (file CRUD).
  editsBlocked?: boolean;
}

// The prologue/epilogue every recorded source edit shares, once. ~45
// handlers across the edit hooks used to open with the same gate-and-
// guard lines and close with a hand-rolled `{ ...current, source }`
// wrapper — and the wrapper is where a subtle bug lives: a no-op build
// must NOT produce a fresh object, or it defeats the history reducer's
// `next === present` detection and records a junk undo entry. The
// epilogue here re-wraps only on a real change, so a handler cannot get
// that wrong.
export function useSourceMutations({
  dispatchEdit,
  editsBlocked = false,
}: Params) {
  // Record an edit built from the current source. `build` returns the
  // next source; null or its own input means "record nothing".
  const mutateSource = useCallback(
    (
      tag: string | null,
      build: (src: LoadedSource) => LoadedSource | null,
    ): void => {
      if (editsBlocked) return;
      dispatchEdit(tag, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const next = build(src);
        if (next === null || next === src) return current;
        return { ...current, source: next };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // The manifest-anchored form: a structural edit that starts from "no
  // manifest, no edit" and lands via withManifest (AST + text together).
  const mutateManifest = useCallback(
    (
      tag: string | null,
      build: (m: Manifest, src: LoadedSource) => Manifest | null,
    ): void => {
      mutateSource(tag, (src) => {
        if (src.manifest === undefined) return null;
        const next = build(src.manifest, src);
        if (next === null || next === src.manifest) return null;
        return withManifest(src, next);
      });
    },
    [mutateSource],
  );

  return { mutateSource, mutateManifest };
}
