import { useEffect, useState } from 'react';
import type { Library } from './library.js';
import { renderThumbnails, type Thumbnail } from './thumbnail.js';

// Thumbnails for the open library, filled in as they are rendered.
//
// Keyed by library identity rather than accumulated: opening a different
// folder starts an empty map, so a stale picture can never sit under a
// new model that happens to share a folder name.
export function useThumbnails(library: Library | null): ReadonlyMap<string, Thumbnail> {
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, Thumbnail>>(
    () => new Map(),
  );

  useEffect(() => {
    setThumbs(new Map());
    if (library === null) return undefined;
    // A plain object rather than AbortController: nothing here is a
    // fetch, and the render loop only needs to be told to stop between
    // models.
    const signal = { aborted: false };
    void renderThumbnails(
      library.models,
      (dir, thumb) => {
        if (signal.aborted) return;
        setThumbs((prev) => new Map(prev).set(dir, thumb));
      },
      signal,
    );
    return () => {
      signal.aborted = true;
    };
  }, [library]);

  return thumbs;
}
