import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type {
  LayoutNode,
  LeafId,
  LeafNode,
  Side,
  SplitNode,
} from '../lib/layout.js';

export interface PanelContent {
  title: string;
  body: ReactNode;
}

interface Props {
  node: LayoutNode;
  path?: Side[];
  // Content for a tool panel (title + body); null for the special
  // '__center__' panel, which renders raw via renderCenter.
  getPanel: (id: LeafId) => PanelContent | null;
  renderCenter: () => ReactNode;
  // Closed (not-placed) panels, for the leaf "+" add menu.
  closedPanels: { id: LeafId; title: string }[];
  // A splitter drag reports the new ratio for the split at `path`.
  onResize: (path: Side[], ratio: number) => void;
  onActivate: (path: Side[], id: LeafId) => void;
  onClose: (path: Side[], id: LeafId) => void;
  onAdd: (path: Side[], id: LeafId) => void;
}

// Each side keeps at least this fraction of its split.
const MIN_RATIO = 0.06;

const isCenter = (leaf: LeafNode): boolean =>
  leaf.panels.length === 1 && leaf.panels[0] === '__center__';

// Renders a binary split-tree: each SplitNode is a flex row/col of two cells
// (a | b) with one draggable splitter between them; LeafNodes own a tab row
// (title tabs + × close, + add) above the active panel's body. '__center__'
// renders raw.
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
  closedPanels,
  onActivate,
  onClose,
  onAdd,
}: Props & { leaf: LeafNode; path: Side[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: Event): void => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  // The tab row holds only tabs + the add control — no panel content like
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
        <div className="dock-tabrow-actions" ref={actionsRef}>
          <button
            type="button"
            className="dock-add"
            title="Add a panel"
            aria-label="Add a panel"
            disabled={closedPanels.length === 0}
            onClick={() => setMenuOpen((o) => !o)}
          >
            +
          </button>
          {menuOpen && closedPanels.length > 0 && (
            <div className="dock-add-menu">
              {closedPanels.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="dock-add-item"
                  onClick={() => {
                    onAdd(path, p.id);
                    setMenuOpen(false);
                  }}
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
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
}: Props & { node: SplitNode; path: Side[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    startPos: number;
    avail: number;
    startRatio: number;
  } | null>(null);

  const onSplitterDown = (e: PointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (el === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    drag.current = {
      startPos: node.dir === 'row' ? e.clientX : e.clientY,
      avail: node.dir === 'row' ? rect.width : rect.height,
      startRatio: node.ratio,
    };
  };

  const onSplitterMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (d.avail <= 0) return;
    const pos = node.dir === 'row' ? e.clientX : e.clientY;
    const ratio = d.startRatio + (pos - d.startPos) / d.avail;
    onResize(path, Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio)));
  };

  const onSplitterUp = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className={`dock-split dock-${node.dir}`} ref={ref}>
      <div className="dock-cell" style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <Dock {...rest} node={node.a} path={[...path, 'a']} onResize={onResize} />
      </div>
      <div
        className={`dock-splitter dock-splitter-${node.dir}`}
        onPointerDown={onSplitterDown}
        onPointerMove={onSplitterMove}
        onPointerUp={onSplitterUp}
        onPointerCancel={onSplitterUp}
      />
      <div
        className="dock-cell"
        style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}
      >
        <Dock {...rest} node={node.b} path={[...path, 'b']} onResize={onResize} />
      </div>
    </div>
  );
}
