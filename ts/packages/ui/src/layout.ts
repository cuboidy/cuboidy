// Binary split-tree layout for the dockable panel system. VS Code /
// react-mosaic style: every split is a 2-way division (a | b) with a direction
// and a ratio. Closing one side collapses the split into the surviving side,
// which fills the space; a drop onto a leaf's edge makes a directional binary
// split (unambiguous). N-way stacks are nested binary splits.

export type SplitDir = 'row' | 'col';
// Path into the tree: a sequence of sides from the root ([] = the root node).
export type Side = 'a' | 'b';

// A panel is identified by whatever string the APP calls it. The tree
// mechanics below never inspect an id — they move it, group it and drop
// it — so the id type is the app's business: the editor has one panel
// set (and dynamic per-file tabs), a workspace has another.
//
// This used to hard-code the editor's ids and its initial arrangement.
// Sharing the mechanism is right; shipping one app's panel list to every
// consumer of it was not, and it only became visible when there WAS a
// second consumer.

export interface SplitNode<Id extends string> {
  kind: 'split';
  dir: SplitDir;
  a: LayoutNode<Id>;
  b: LayoutNode<Id>;
  ratio: number; // a's fraction of the split (0..1); b gets 1 - ratio
}

export interface LeafNode<Id extends string> {
  kind: 'leaf';
  panels: Id[]; // tabs (length ≥ 1)
  active: Id; // shown tab
}

export type LayoutNode<Id extends string = string> =
  | SplitNode<Id>
  | LeafNode<Id>;

export const leaf = <Id extends string>(id: Id): LeafNode<Id> => ({ kind: 'leaf', panels: [id], active: id });
export const split = <Id extends string>(
  dir: SplitDir,
  a: LayoutNode<Id>,
  b: LayoutNode<Id>,
  ratio: number,
): SplitNode<Id> => ({ kind: 'split', dir, a, b, ratio });

// All panel ids currently placed somewhere in the tree.
export function placedPanels<Id extends string>(
  node: LayoutNode<Id>,
  acc: Set<Id> = new Set(),
): Set<Id> {
  if (node.kind === 'leaf') {
    for (const p of node.panels) acc.add(p);
  } else {
    placedPanels(node.a, acc);
    placedPanels(node.b, acc);
  }
  return acc;
}

// Apply `fn` to the leaf at `path`, returning a new tree (off-path shared).
function updateLeaf<Id extends string>(
  node: LayoutNode<Id>,
  path: readonly Side[],
  fn: (leaf: LeafNode<Id>) => LeafNode<Id>,
): LayoutNode<Id> {
  if (path.length === 0) return node.kind === 'leaf' ? fn(node) : node;
  if (node.kind !== 'split') return node;
  const [side, ...rest] = path;
  if (side === 'a') return { ...node, a: updateLeaf(node.a, rest, fn) };
  if (side === 'b') return { ...node, b: updateLeaf(node.b, rest, fn) };
  return node;
}

// Set the active tab of the leaf at `path`.
export function withActiveAt<Id extends string>(
  root: LayoutNode<Id>,
  path: readonly Side[],
  active: Id,
): LayoutNode<Id> {
  return updateLeaf(root, path, (l) =>
    l.panels.includes(active) ? { ...l, active } : l,
  );
}

// Append a panel as a tab to the leaf at `path` and make it active.
export function addPanelAt<Id extends string>(
  root: LayoutNode<Id>,
  path: readonly Side[],
  id: Id,
): LayoutNode<Id> {
  return updateLeaf(root, path, (l) =>
    l.panels.includes(id) ? l : { ...l, panels: [...l.panels, id], active: id },
  );
}

// Set the ratio of the split at `path`.
export function withRatioAt<Id extends string>(
  root: LayoutNode<Id>,
  path: readonly Side[],
  ratio: number,
): LayoutNode<Id> {
  if (path.length === 0) {
    return root.kind === 'split' ? { ...root, ratio } : root;
  }
  if (root.kind !== 'split') return root;
  const [side, ...rest] = path;
  if (side === 'a') return { ...root, a: withRatioAt(root.a, rest, ratio) };
  if (side === 'b') return { ...root, b: withRatioAt(root.b, rest, ratio) };
  return root;
}

function samePath(a: readonly Side[], b: readonly Side[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function insertBeside<Id extends string>(
  panels: Id[],
  id: Id,
  targetId: Id,
  before: boolean,
): Id[] {
  const ti = panels.indexOf(targetId);
  if (ti < 0) return [...panels, id];
  const at = before ? ti : ti + 1;
  return [...panels.slice(0, at), id, ...panels.slice(at)];
}

// Place `id` immediately before/after `targetId` in the leaf at `toPath`.
// Same leaf → reorder its tabs; other leaf → insert there at that position
// and remove from the source.
export function placePanelBeside<Id extends string>(
  root: LayoutNode<Id>,
  toPath: readonly Side[],
  targetId: Id,
  before: boolean,
  id: Id,
  fromPath: readonly Side[],
): LayoutNode<Id> {
  if (id === targetId) return root;
  if (samePath(fromPath, toPath)) {
    return updateLeaf(root, toPath, (l) => ({
      ...l,
      panels: insertBeside(
        l.panels.filter((p) => p !== id),
        id,
        targetId,
        before,
      ),
      active: id,
    }));
  }
  const added = updateLeaf(root, toPath, (l) =>
    l.panels.includes(id)
      ? l
      : { ...l, panels: insertBeside(l.panels, id, targetId, before), active: id },
  );
  // `added` already holds id at toPath, so removing it from the source can
  // never empty the whole tree — the `?? added` is just a type-level guard.
  return closeRec(added, fromPath, id) ?? added;
}

export type Edge = 'top' | 'bottom' | 'left' | 'right';

function edgeToSplit(edge: Edge): { dir: SplitDir; firstIsNew: boolean } {
  switch (edge) {
    case 'top':
      return { dir: 'col', firstIsNew: true };
    case 'bottom':
      return { dir: 'col', firstIsNew: false };
    case 'left':
      return { dir: 'row', firstIsNew: true };
    case 'right':
      return { dir: 'row', firstIsNew: false };
  }
}

function splitLeafAt<Id extends string>(
  node: LayoutNode<Id>,
  path: readonly Side[],
  dir: SplitDir,
  newLeaf: LeafNode<Id>,
  firstIsNew: boolean,
): LayoutNode<Id> {
  if (path.length === 0) {
    if (node.kind !== 'leaf') return node;
    return firstIsNew
      ? split(dir, newLeaf, node, 0.5)
      : split(dir, node, newLeaf, 0.5);
  }
  if (node.kind !== 'split') return node;
  const [s, ...rest] = path;
  if (s === 'a') return { ...node, a: splitLeafAt(node.a, rest, dir, newLeaf, firstIsNew) };
  if (s === 'b') return { ...node, b: splitLeafAt(node.b, rest, dir, newLeaf, firstIsNew) };
  return node;
}

// Drop a panel onto the `edge` of the leaf at `toPath`: the target leaf is
// replaced by a binary split with the dragged panel as a new leaf on that
// side. Split the target FIRST, then remove the panel from its source — and
// if source === target, the original leaf has moved into the new split, so
// fix up the source path accordingly.
export function splitLeafWith<Id extends string>(
  root: LayoutNode<Id>,
  toPath: readonly Side[],
  edge: Edge,
  id: Id,
  fromPath: readonly Side[],
): LayoutNode<Id> {
  const { dir, firstIsNew } = edgeToSplit(edge);
  const newLeaf: LeafNode<Id> = { kind: 'leaf', panels: [id], active: id };
  const splitTree = splitLeafAt(root, toPath, dir, newLeaf, firstIsNew);
  const origSide: Side = firstIsNew ? 'b' : 'a';
  const newFromPath = samePath(fromPath, toPath)
    ? [...toPath, origSide]
    : fromPath;
  // The new split holds id, so the source removal can't empty the tree.
  return closeRec(splitTree, newFromPath, id) ?? splitTree;
}

// Remove a panel from the leaf at `path`. If the leaf empties, the parent
// split collapses into its surviving side (which then fills the space).
// Closing the very last panel empties the whole dock → returns null (App
// renders an empty-dock state you can add panels back from).
export function closePanelAt<Id extends string>(
  root: LayoutNode<Id>,
  path: readonly Side[],
  id: Id,
): LayoutNode<Id> | null {
  return closeRec(root, path, id);
}

function closeRec<Id extends string>(
  node: LayoutNode<Id>,
  path: readonly Side[],
  id: Id,
): LayoutNode<Id> | null {
  if (path.length === 0) {
    if (node.kind !== 'leaf') return node;
    const panels = node.panels.filter((p) => p !== id);
    if (panels.length === 0) return null; // leaf empties → remove it
    const active = panels.includes(node.active) ? node.active : panels[0]!;
    return { ...node, panels, active };
  }
  if (node.kind !== 'split') return node;
  const [side, ...rest] = path;
  if (side === 'a') {
    const a = closeRec(node.a, rest, id);
    return a === null ? node.b : { ...node, a }; // collapse to sibling
  }
  if (side === 'b') {
    const b = closeRec(node.b, rest, id);
    return b === null ? node.a : { ...node, b };
  }
  return node;
}

// Locate the leaf hosting `id` (DFS, left-first): its path + the leaf node.
function locate<Id extends string>(
  node: LayoutNode<Id>,
  id: Id,
  path: Side[] = [],
): { path: Side[]; leaf: LeafNode<Id> } | null {
  if (node.kind === 'leaf') {
    return node.panels.includes(id) ? { path, leaf: node } : null;
  }
  return locate(node.a, id, [...path, 'a']) ?? locate(node.b, id, [...path, 'b']);
}

// Path to the leaf currently hosting `id`, or null if not placed anywhere.
export function findLeafPath<Id extends string>(root: LayoutNode<Id>, id: Id): Side[] | null {
  return locate(root, id)?.path ?? null;
}

// True when `id` is the *visible* (active) tab of its leaf — i.e. on screen,
// not just placed-but-behind-another-tab.
export function isPanelVisible<Id extends string>(root: LayoutNode<Id>, id: Id): boolean {
  const found = locate(root, id);
  return found !== null && found.leaf.active === id;
}

// Path to the left-most leaf — a guaranteed-existing fallback host.
function firstLeafPath<Id extends string>(node: LayoutNode<Id>, path: Side[] = []): Side[] {
  return node.kind === 'leaf' ? [...path] : firstLeafPath(node.a, [...path, 'a']);
}

// Bring `id` to the foreground: if already placed, make it its leaf's active
// tab; otherwise re-open it as a tab beside `preferHost`, falling back to
// the left-most leaf. From an empty dock (null) it seeds a fresh
// single-panel leaf.
//
// `preferHost` is the app's main surface — the panel a reopened one should
// appear next to. It is a parameter because it used to be the string
// 'preview', which is the editor's viewport and meant nothing to any other
// app: a panel set is the app's, and so is which of them is the middle.
export function openPanelById<Id extends string>(
  root: LayoutNode<Id> | null,
  id: Id,
  preferHost?: Id,
): LayoutNode<Id> {
  if (root === null) return { kind: 'leaf', panels: [id], active: id };
  const here = findLeafPath(root, id);
  if (here !== null) return withActiveAt(root, here, id);
  const preferred = preferHost === undefined ? null : findLeafPath(root, preferHost);
  return addPanelAt(root, preferred ?? firstLeafPath(root), id);
}
