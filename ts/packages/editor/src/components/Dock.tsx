import { Fragment, useRef, type PointerEvent, type ReactNode } from 'react';
import type { LayoutNode, LeafId, LeafNode, SplitNode } from '../lib/layout.js';

export interface PanelContent {
  title: string;
  body: ReactNode;
}

interface Props {
  node: LayoutNode;
  path?: number[];
  // Content for a tool panel (title/meta/toolbar/body); null for the special
  // '__center__' panel, which renders raw via renderCenter.
  getPanel: (id: LeafId) => PanelContent | null;
  renderCenter: () => ReactNode;
  // A splitter drag reports new child sizes for the split at `path`.
  onResize: (path: number[], sizes: number[]) => void;
  onActivate: (path: number[], id: LeafId) => void;
  onClose: (path: number[], id: LeafId) => void;
}

// Each cell keeps at least this fraction of its split's space.
const MIN_RATIO = 0.06;

const isCenter = (leaf: LeafNode): boolean =>
  leaf.panels.length === 1 && leaf.panels[0] === '__center__';

// Renders a split-tree layout: SplitNodes become flex row/col containers with
// draggable splitters; LeafNodes own a dedicated tab row (title tabs + × to
// close) above the active panel's body. The '__center__' leaf renders raw.
export function Dock(props: Props) {
  const { node, path = [], renderCenter } = props;
  if (node.kind === 'leaf') {
    if (isCenter(node)) return <>{renderCenter()}</>;
    return <DockLeaf {...props} leaf={node} path={path} />;
  }
  return <DockSplit {...props} node={node} path={path} />;
}

function DockLeaf({
  leaf,
  path,
  getPanel,
  onActivate,
  onClose,
}: Props & { leaf: LeafNode; path: number[] }) {
  // The tab row holds only tabs (and, later, + / ⋯) — no panel content like
  // counts. Anything panel-specific lives in the body.
  return (
    <section className="dock-leaf">
      <div className="dock-tabrow">
        <div className="dock-tabs">
          {leaf.panels.map((id) => (
            <div
              key={id}
              className={`dock-tab${id === leaf.active ? ' active' : ''}`}
            >
              <button
                type="button"
                className="dock-tab-label"
                onClick={() => onActivate(path, id)}
              >
                {getPanel(id)?.title ?? id}
              </button>
              <button
                type="button"
                className="dock-tab-close"
                aria-label={`Close ${getPanel(id)?.title ?? id}`}
                title="Close panel"
                onClick={() => onClose(path, id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="dock-leaf-body">{getPanel(leaf.active)?.body}</div>
    </section>
  );
}

function DockSplit({
  node,
  path,
  onResize,
  ...rest
}: Props & { node: SplitNode; path: number[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
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
            <Dock {...rest} node={child} path={[...path, i]} onResize={onResize} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
