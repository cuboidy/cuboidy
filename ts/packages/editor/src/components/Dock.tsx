import { type ReactNode } from 'react';
import type { LayoutNode, LeafNode } from '../lib/layout.js';

interface Props {
  node: LayoutNode;
  // Renders a leaf's content (the owner decides Panel-wrapping vs the raw
  // center pane). Kept out of the Dock so the Dock is pure layout structure.
  renderLeaf: (leaf: LeafNode) => ReactNode;
}

// Renders a split-tree layout: SplitNodes become flex row/col containers whose
// cells flex-grow by their `sizes` ratio; LeafNodes delegate to renderLeaf.
// Phase B = fixed sizes; draggable splitters + persistence come in B2.
export function Dock({ node, renderLeaf }: Props) {
  if (node.kind === 'leaf') return <>{renderLeaf(node)}</>;
  return (
    <div className={`dock-split dock-${node.dir}`}>
      {node.children.map((child, i) => (
        <div
          // Static tree (no reordering yet in B1) → index key is stable.
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="dock-cell"
          style={{ flexGrow: node.sizes[i] ?? 1, flexBasis: 0 }}
        >
          <Dock node={child} renderLeaf={renderLeaf} />
        </div>
      ))}
    </div>
  );
}
