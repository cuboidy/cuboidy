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
