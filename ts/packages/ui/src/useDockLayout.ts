import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  addPanelAt,
  closePanelAt,
  openPanelById,
  placePanelBeside,
  placedPanels,
  splitLeafWith,
  withActiveAt,
  withRatioAt,
  type Edge,
  type LayoutNode,
  type Side,
} from './layout.js';

// The dock's layout state plus the six mutation handlers <Dock> takes,
// in one hook. Both apps used to wire these by hand — the editor
// memoized each one, the workspace passed fresh inline arrows on every
// render — which is exactly the drift a shared hook prevents. Every
// mutation no-ops on a null (all-closed) dock, keeping the reducer
// total; layout is session-scoped by design (no persistence).
export interface DockHandlers<Id extends string> {
  onResize: (path: Side[], ratio: number) => void;
  onActivate: (path: Side[], id: Id) => void;
  onClose: (path: Side[], id: Id) => void;
  onAdd: (path: Side[], id: Id) => void;
  onSplit: (toPath: Side[], edge: Edge, id: Id, fromPath: Side[]) => void;
  onReorder: (
    toPath: Side[],
    targetId: Id,
    before: boolean,
    id: Id,
    fromPath: Side[],
  ) => void;
}

export interface DockLayout<Id extends string> extends DockHandlers<Id> {
  layout: LayoutNode<Id> | null;
  // Escape hatch for app-specific layout ops; prefer openPanel / reset.
  setLayout: Dispatch<SetStateAction<LayoutNode<Id> | null>>;
  // Panels not currently placed anywhere — offered by each leaf's + menu,
  // and by the empty-dock state (where the set is everything).
  closedPanels: Array<{ id: Id; title: string }>;
  // Bring a panel to the foreground, re-adding it (beside `mainPanel`,
  // when given) if closed; seeds a fresh leaf from an empty dock.
  openPanel: (id: Id) => void;
  reset: () => void;
}

export function useDockLayout<Id extends string>(opts: {
  initial: LayoutNode<Id> | null;
  // The reopenable panel set. Dynamic panels (the editor's per-file tabs)
  // may exist outside it; they just don't appear in the + menu.
  allPanels: readonly Id[];
  titleOf: (id: Id) => string;
  // Where a reopened panel lands when its own leaf is gone — the app's
  // main surface (the editor's preview, the workspace's view).
  mainPanel?: Id;
}): DockLayout<Id> {
  const { initial, allPanels, titleOf, mainPanel } = opts;
  const [layout, setLayout] = useState<LayoutNode<Id> | null>(initial);

  const onResize = useCallback((path: Side[], ratio: number) => {
    setLayout((l) => (l === null ? null : withRatioAt(l, path, ratio)));
  }, []);
  const onActivate = useCallback((path: Side[], id: Id) => {
    setLayout((l) => (l === null ? null : withActiveAt(l, path, id)));
  }, []);
  const onClose = useCallback((path: Side[], id: Id) => {
    setLayout((l) => (l === null ? null : closePanelAt(l, path, id)));
  }, []);
  const onAdd = useCallback((path: Side[], id: Id) => {
    setLayout((l) => (l === null ? null : addPanelAt(l, path, id)));
  }, []);
  const onSplit = useCallback(
    (toPath: Side[], edge: Edge, id: Id, fromPath: Side[]) => {
      setLayout((l) =>
        l === null ? null : splitLeafWith(l, toPath, edge, id, fromPath),
      );
    },
    [],
  );
  const onReorder = useCallback(
    (toPath: Side[], targetId: Id, before: boolean, id: Id, fromPath: Side[]) => {
      setLayout((l) =>
        l === null ? null : placePanelBeside(l, toPath, targetId, before, id, fromPath),
      );
    },
    [],
  );

  const openPanel = useCallback(
    (id: Id) => setLayout((l) => openPanelById(l, id, mainPanel)),
    [mainPanel],
  );
  const reset = useCallback(() => setLayout(initial), [initial]);

  const closedPanels = useMemo(() => {
    const placed = layout === null ? new Set<Id>() : placedPanels(layout);
    return allPanels
      .filter((id) => !placed.has(id))
      .map((id) => ({ id, title: titleOf(id) }));
  }, [layout, allPanels, titleOf]);

  return {
    layout,
    setLayout,
    closedPanels,
    openPanel,
    reset,
    onResize,
    onActivate,
    onClose,
    onAdd,
    onSplit,
    onReorder,
  };
}
