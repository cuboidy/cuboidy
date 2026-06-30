// Recursive split-tree layout for the dockable panel system (design:
// docs/panel-system-design.md). A layout is a tree of SplitNodes (row/col
// with per-child sizes) and LeafNodes (a tab-group of panels). Phase B
// renders this with fixed sizes; resize + persistence land in B2.

export type SplitDir = 'row' | 'col';

// Tool panels live in the registry; '__center__' is a special leaf that
// renders the existing main pane (TabBar + preview/source). It becomes real
// panels (preview / cvoxSource / manifestSource / timeline) in Phase D.
export type PanelId = 'files' | 'parts' | 'properties' | 'palette';
export type LeafId = PanelId | '__center__';

export interface SplitNode {
  kind: 'split';
  dir: SplitDir;
  children: LayoutNode[]; // length ≥ 2
  sizes: number[]; // relative flex ratios, one per child
}

export interface LeafNode {
  kind: 'leaf';
  panels: LeafId[]; // tabs (length ≥ 1)
  active: LeafId; // shown tab
}

export type LayoutNode = SplitNode | LeafNode;

const leaf = (id: LeafId): LeafNode => ({ kind: 'leaf', panels: [id], active: id });

// All panel ids currently placed somewhere in the tree.
export function placedPanels(
  node: LayoutNode,
  acc: Set<LeafId> = new Set(),
): Set<LeafId> {
  if (node.kind === 'leaf') {
    for (const p of node.panels) acc.add(p);
  } else {
    for (const c of node.children) placedPanels(c, acc);
  }
  return acc;
}

// Set the active tab of the leaf at `path`.
export function withActiveAt(
  root: LayoutNode,
  path: readonly number[],
  active: LeafId,
): LayoutNode {
  if (path.length === 0) {
    return root.kind === 'leaf' && root.panels.includes(active)
      ? { ...root, active }
      : root;
  }
  if (root.kind !== 'split') return root;
  const [i, ...rest] = path;
  return {
    ...root,
    children: root.children.map((c, idx) =>
      idx === i ? withActiveAt(c, rest, active) : c,
    ),
  };
}

// Remove a panel from the leaf at `path`. If the leaf empties, drop it from
// its parent split; a split left with one child collapses into that child.
export function closePanelAt(
  root: LayoutNode,
  path: readonly number[],
  id: LeafId,
): LayoutNode {
  return closeRec(root, path, id) ?? root;
}

function closeRec(
  node: LayoutNode,
  path: readonly number[],
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
  const i = path[0];
  if (i === undefined) return node;
  const rest = path.slice(1);
  const child = node.children[i];
  if (child === undefined) return node;
  const next = closeRec(child, rest, id);
  const children = node.children.slice();
  const sizes = node.sizes.slice();
  if (next === null) {
    children.splice(i, 1);
    sizes.splice(i, 1);
  } else {
    children[i] = next;
  }
  if (children.length === 1) return children[0]!; // collapse single-child split
  if (children.length === 0) return null;
  return { ...node, children, sizes };
}

// Return a copy of the tree with the SplitNode at `path` given new child
// `sizes` (path = child indices from the root; [] = the root split). Used by
// the resize splitters; everything off the path is shared by reference.
export function withSizesAt(
  root: LayoutNode,
  path: readonly number[],
  sizes: number[],
): LayoutNode {
  if (path.length === 0) {
    return root.kind === 'split' ? { ...root, sizes } : root;
  }
  if (root.kind !== 'split') return root;
  const [i, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child, idx) =>
      idx === i ? withSizesAt(child, rest, sizes) : child,
    ),
  };
}

// Default layout = the recommended IA: left column stacks Files / Parts /
// Properties (select→edit adjacency, #5); right holds Palette alone (cvox
// separated from rig, #6); the center is the existing main pane.
export const initialLayout: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.2, 0.62, 0.18],
  children: [
    {
      kind: 'split',
      dir: 'col',
      sizes: [0.26, 0.44, 0.3],
      children: [leaf('files'), leaf('parts'), leaf('properties')],
    },
    leaf('__center__'),
    leaf('palette'),
  ],
};
