import { Fragment, useRef, type PointerEvent, type ReactNode } from 'react';
import type { LayoutNode, LeafNode, SplitNode } from '../lib/layout.js';

interface Props {
  node: LayoutNode;
  // Renders a leaf's content (the owner decides Panel-wrapping vs the raw
  // center pane). Kept out of the Dock so the Dock is pure layout structure.
  renderLeaf: (leaf: LeafNode) => ReactNode;
  // A splitter drag reports new child sizes for the split at `path` (child
  // indices from the root; [] = root). The owner updates the layout tree.
  onResize: (path: number[], sizes: number[]) => void;
  path?: number[];
}

// Each cell keeps at least this fraction of its split's space.
const MIN_RATIO = 0.06;

// Renders a split-tree layout: SplitNodes become flex row/col containers whose
// cells flex-grow by their `sizes` ratio, with draggable splitters between
// them; LeafNodes delegate to renderLeaf. Resize state lives in the owner
// (App) — no persistence yet (Phase C).
export function Dock({ node, renderLeaf, onResize, path = [] }: Props) {
  if (node.kind === 'leaf') return <>{renderLeaf(node)}</>;
  return (
    <DockSplit node={node} renderLeaf={renderLeaf} onResize={onResize} path={path} />
  );
}

function DockSplit({
  node,
  renderLeaf,
  onResize,
  path,
}: Props & { node: SplitNode; path: number[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Live drag state: which boundary, where it started, the split's pixel size
  // on that axis, and the sizes at grab time.
  const drag = useRef<{
    i: number;
    startPos: number;
    avail: number;
    startSizes: number[];
  } | null>(null);

  const onSplitterDown =
    (boundary: number) => (e: PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (el === null) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      drag.current = {
        i: boundary,
        startPos: node.dir === 'row' ? e.clientX : e.clientY,
        avail: node.dir === 'row' ? rect.width : rect.height,
        startSizes: node.sizes.slice(),
      };
    };

  const onSplitterMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (d.avail <= 0) return;
    const pos = node.dir === 'row' ? e.clientX : e.clientY;
    const total = d.startSizes.reduce((a, b) => a + b, 0);
    const min = MIN_RATIO * total;
    const lo = d.startSizes[d.i]!;
    const hi = d.startSizes[d.i + 1]!;
    // Pixel delta → ratio delta, clamped so both neighbors stay >= min.
    const raw = ((pos - d.startPos) / d.avail) * total;
    const delta = Math.max(-(lo - min), Math.min(hi - min, raw));
    const sizes = d.startSizes.slice();
    sizes[d.i] = lo + delta;
    sizes[d.i + 1] = hi - delta;
    onResize(path, sizes);
  };

  const onSplitterUp = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className={`dock-split dock-${node.dir}`} ref={ref}>
      {node.children.map((child, i) => (
        // Static tree (no reordering yet) → index key is stable.
        // eslint-disable-next-line react/no-array-index-key
        <Fragment key={i}>
          {i > 0 && (
            <div
              className={`dock-splitter dock-splitter-${node.dir}`}
              onPointerDown={onSplitterDown(i - 1)}
              onPointerMove={onSplitterMove}
              onPointerUp={onSplitterUp}
              onPointerCancel={onSplitterUp}
            />
          )}
          <div
            className="dock-cell"
            style={{ flexGrow: node.sizes[i] ?? 1, flexBasis: 0 }}
          >
            <Dock
              node={child}
              renderLeaf={renderLeaf}
              onResize={onResize}
              path={[...path, i]}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
