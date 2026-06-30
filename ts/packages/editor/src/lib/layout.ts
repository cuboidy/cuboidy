// Binary split-tree layout for the dockable panel system (design:
// docs/panel-system-design.md). VS Code / react-mosaic style: every split is
// a 2-way division (a | b) with a direction and a ratio. Closing one side
// collapses the split into the surviving side, which fills the space; a drop
// onto a leaf's edge makes a directional binary split (unambiguous). N-way
// stacks are nested binary splits.

export type SplitDir = 'row' | 'col';
// Path into the tree: a sequence of sides from the root ([] = the root node).
export type Side = 'a' | 'b';

// Tool panels live in the registry; '__center__' is a special leaf that
// renders the existing main pane (TabBar + preview/source). It becomes real
// panels (preview / cvoxSource / manifestSource / timeline) in Phase D.
export type PanelId = 'files' | 'parts' | 'properties' | 'palette';
export type LeafId = PanelId | '__center__';

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

// The dockable tool panels (the center is special and never closed/added).
export const TOOL_PANELS: PanelId[] = ['files', 'parts', 'properties', 'palette'];

export const PANEL_TITLES: Record<PanelId, string> = {
  files: 'Files',
  parts: 'Parts',
  properties: 'Properties',
  palette: 'Palette',
};

// Default layout (nested binary): left column = Files over (Parts over
// Properties); the rest = center over... beside Palette. Realizes the IA:
// Parts/Properties adjacent (#5), Palette separated from rig (#6).
export const initialLayout: LayoutNode = split(
  'row',
  split('col', leaf('files'), split('col', leaf('parts'), leaf('properties'), 0.4), 0.25),
  split('row', leaf('__center__'), leaf('palette'), 0.78),
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

// Move a panel from the leaf at `fromPath` to the leaf at `toPath` (as a tab).
// Add to the target FIRST (a tab add doesn't change tree structure, so paths
// stay valid), then remove from the source (which may collapse its split).
export function movePanel(
  root: LayoutNode,
  fromPath: readonly Side[],
  toPath: readonly Side[],
  id: LeafId,
): LayoutNode {
  if (samePath(fromPath, toPath)) return root;
  return closePanelAt(addPanelAt(root, toPath, id), fromPath, id);
}

// Remove a panel from the leaf at `path`. If the leaf empties, the parent
// split collapses into its surviving side (which then fills the space).
export function closePanelAt(
  root: LayoutNode,
  path: readonly Side[],
  id: LeafId,
): LayoutNode {
  return closeRec(root, path, id) ?? root;
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
