// Binary split-tree layout for the dockable panel system (design:
// docs/panel-system-design.md). VS Code / react-mosaic style: every split is
// a 2-way division (a | b) with a direction and a ratio. Closing one side
// collapses the split into the surviving side, which fills the space; a drop
// onto a leaf's edge makes a directional binary split (unambiguous). N-way
// stacks are nested binary splits.

export type SplitDir = 'row' | 'col';
// Path into the tree: a sequence of sides from the root ([] = the root node).
export type Side = 'a' | 'b';

// Every leaf hosts dockable panels (tabs). Tool panels sit on the sides; the
// source panels (preview / cvox / manifest) are the model-viewing surfaces —
// formerly the bespoke in-center TabBar, now first-class dock tabs you can
// move, split and reorder like any other. (The timeline becomes its own
// panel in a later Phase D step.)
export type ToolPanelId =
  | 'files'
  | 'parts'
  | 'properties'
  | 'palette'
  | 'inspector'
  | 'console';
export type SourcePanelId = 'preview' | 'cvox' | 'manifest' | 'timeline';
// Dynamic per-file editor tabs (v0.7 multi-file packages): one panel per
// package file, keyed by its /-relative path. Opened from the Files tree;
// not in ALL_PANELS (closing one just removes it — reopen via the tree).
export type FilePanelId = `file:${string}`;
export type LeafId = ToolPanelId | SourcePanelId | FilePanelId;

export const filePanel = (path: string): FilePanelId => `file:${path}`;
export function filePanelPath(id: LeafId): string | null {
  return id.startsWith('file:') ? id.slice('file:'.length) : null;
}

export interface SplitNode {
  kind: 'split';
  dir: SplitDir;
  a: LayoutNode;
  b: LayoutNode;
  ratio: number; // a's fraction of the split (0..1); b gets 1 - ratio
}

export interface LeafNode {
  kind: 'leaf';
  panels: LeafId[]; // tabs (length ≥ 1)
  active: LeafId; // shown tab
}

export type LayoutNode = SplitNode | LeafNode;

const leaf = (id: LeafId): LeafNode => ({ kind: 'leaf', panels: [id], active: id });
const split = (
  dir: SplitDir,
  a: LayoutNode,
  b: LayoutNode,
  ratio: number,
): SplitNode => ({ kind: 'split', dir, a, b, ratio });

// Every dockable panel. The leaf "+" menu offers any of these not currently
// placed anywhere (so a closed panel can always be reopened). Titles for the
// dynamic ones (cvox/manifest take their file name) live in App.panelTitle.
export const ALL_PANELS: LeafId[] = [
  'files',
  'parts',
  'properties',
  'palette',
  'inspector',
  'preview',
  'cvox',
  'manifest',
  'timeline',
  'console',
];

// Default layout (nested binary): left column = Files over (Parts over
// Properties); center column = the source panels (Preview/cvox/manifest as
// tabs) over the bottom leaf (Timeline with the Console tabbed behind it,
// VS Code style); right column = Palette over the Key Inspector (the
// keyframe editor's selection detail, kept near the timeline's right end —
// where it used to live as a fixed sidebar). Realizes the IA:
// Parts/Properties adjacent (#5), Palette separated from the rig (#6), and
// the timeline docked under the viewport like a Premiere-style editor.
export const initialLayout: LayoutNode = split(
  'row',
  split('col', leaf('files'), split('col', leaf('parts'), leaf('properties'), 0.4), 0.25),
  split(
    'row',
    split(
      'col',
      { kind: 'leaf', panels: ['preview', 'cvox', 'manifest'], active: 'preview' },
      { kind: 'leaf', panels: ['timeline', 'console'], active: 'timeline' },
      0.68,
    ),
    split('col', leaf('palette'), leaf('inspector'), 0.55),
    0.78,
  ),
  0.2,
);

// All panel ids currently placed somewhere in the tree.
export function placedPanels(
  node: LayoutNode,
  acc: Set<LeafId> = new Set(),
): Set<LeafId> {
  if (node.kind === 'leaf') {
    for (const p of node.panels) acc.add(p);
  } else {
    placedPanels(node.a, acc);
    placedPanels(node.b, acc);
  }
  return acc;
}

// Apply `fn` to the leaf at `path`, returning a new tree (off-path shared).
function updateLeaf(
  node: LayoutNode,
  path: readonly Side[],
  fn: (leaf: LeafNode) => LeafNode,
): LayoutNode {
  if (path.length === 0) return node.kind === 'leaf' ? fn(node) : node;
  if (node.kind !== 'split') return node;
  const [side, ...rest] = path;
  if (side === 'a') return { ...node, a: updateLeaf(node.a, rest, fn) };
  if (side === 'b') return { ...node, b: updateLeaf(node.b, rest, fn) };
  return node;
}

// Set the active tab of the leaf at `path`.
export function withActiveAt(
  root: LayoutNode,
  path: readonly Side[],
  active: LeafId,
): LayoutNode {
  return updateLeaf(root, path, (l) =>
    l.panels.includes(active) ? { ...l, active } : l,
  );
}

// Append a panel as a tab to the leaf at `path` and make it active.
export function addPanelAt(
  root: LayoutNode,
  path: readonly Side[],
  id: LeafId,
): LayoutNode {
  return updateLeaf(root, path, (l) =>
    l.panels.includes(id) ? l : { ...l, panels: [...l.panels, id], active: id },
  );
}

// Set the ratio of the split at `path`.
export function withRatioAt(
  root: LayoutNode,
  path: readonly Side[],
  ratio: number,
): LayoutNode {
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

function insertBeside(
  panels: LeafId[],
  id: LeafId,
  targetId: LeafId,
  before: boolean,
): LeafId[] {
  const ti = panels.indexOf(targetId);
  if (ti < 0) return [...panels, id];
  const at = before ? ti : ti + 1;
  return [...panels.slice(0, at), id, ...panels.slice(at)];
}

// Place `id` immediately before/after `targetId` in the leaf at `toPath`.
// Same leaf → reorder its tabs; other leaf → insert there at that position
// and remove from the source.
export function placePanelBeside(
  root: LayoutNode,
  toPath: readonly Side[],
  targetId: LeafId,
  before: boolean,
  id: LeafId,
  fromPath: readonly Side[],
): LayoutNode {
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

function splitLeafAt(
  node: LayoutNode,
  path: readonly Side[],
  dir: SplitDir,
  newLeaf: LeafNode,
  firstIsNew: boolean,
): LayoutNode {
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
export function splitLeafWith(
  root: LayoutNode,
  toPath: readonly Side[],
  edge: Edge,
  id: LeafId,
  fromPath: readonly Side[],
): LayoutNode {
  const { dir, firstIsNew } = edgeToSplit(edge);
  const newLeaf: LeafNode = { kind: 'leaf', panels: [id], active: id };
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
export function closePanelAt(
  root: LayoutNode,
  path: readonly Side[],
  id: LeafId,
): LayoutNode | null {
  return closeRec(root, path, id);
}

function closeRec(
  node: LayoutNode,
  path: readonly Side[],
  id: LeafId,
): LayoutNode | null {
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
function locate(
  node: LayoutNode,
  id: LeafId,
  path: Side[] = [],
): { path: Side[]; leaf: LeafNode } | null {
  if (node.kind === 'leaf') {
    return node.panels.includes(id) ? { path, leaf: node } : null;
  }
  return locate(node.a, id, [...path, 'a']) ?? locate(node.b, id, [...path, 'b']);
}

// Path to the leaf currently hosting `id`, or null if not placed anywhere.
export function findLeafPath(root: LayoutNode, id: LeafId): Side[] | null {
  return locate(root, id)?.path ?? null;
}

// True when `id` is the *visible* (active) tab of its leaf — i.e. on screen,
// not just placed-but-behind-another-tab.
export function isPanelVisible(root: LayoutNode, id: LeafId): boolean {
  const found = locate(root, id);
  return found !== null && found.leaf.active === id;
}

// Path to the left-most leaf — a guaranteed-existing fallback host.
function firstLeafPath(node: LayoutNode, path: Side[] = []): Side[] {
  return node.kind === 'leaf' ? [...path] : firstLeafPath(node.a, [...path, 'a']);
}

// Bring `id` to the foreground: if already placed, make it its leaf's active
// tab; otherwise re-open it as a tab on the center (preview's leaf), falling
// back to the left-most leaf. From an empty dock (null) it seeds a fresh
// single-panel leaf.
export function openPanelById(root: LayoutNode | null, id: LeafId): LayoutNode {
  if (root === null) return { kind: 'leaf', panels: [id], active: id };
  const here = findLeafPath(root, id);
  if (here !== null) return withActiveAt(root, here, id);
  const host = findLeafPath(root, 'preview') ?? firstLeafPath(root);
  return addPanelAt(root, host, id);
}
