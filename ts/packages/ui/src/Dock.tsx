import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { Plus, X } from 'lucide-react';
import type {
  Edge,
  LayoutNode,
  LeafNode,
  Side,
  SplitNode,
} from './layout.js';

export interface PanelContent {
  title: string;
  body: ReactNode;
  // When set, the body fills the panel (no scroll wrapper) and anchors any
  // absolutely-positioned overlay — used by the 3D preview and the source
  // editors, which manage their own internal scrolling.
  fill?: boolean;
}

interface Props<Id extends string> {
  node: LayoutNode<Id>;
  path?: Side[];
  // Content for the panel at `id` (title + body). Null only defensively
  // (e.g. nothing loaded); a placed panel always has content.
  getPanel: (id: Id) => PanelContent | null;
  // Closed (not-placed) panels, for the leaf "+" add menu.
  closedPanels: { id: Id; title: string }[];
  onResize: (path: Side[], ratio: number) => void;
  onActivate: (path: Side[], id: Id) => void;
  onClose: (path: Side[], id: Id) => void;
  onAdd: (path: Side[], id: Id) => void;
  // Drop on the BODY edge → split the leaf at `toPath` that direction.
  onSplit: (toPath: Side[], edge: Edge, id: Id, fromPath: Side[]) => void;
  // Drop on the HEADER → place the dragged panel before/after a tab (reorder
  // within the leaf, or move in / append at that position).
  onReorder: (
    toPath: Side[],
    targetId: Id,
    before: boolean,
    id: Id,
    fromPath: Side[],
  ) => void;
}

// Each side keeps at least this fraction of its split.
const MIN_RATIO = 0.06;

// dataTransfer payload for a dragged tab.
const DRAG_MIME = 'application/x-cuboidy-panel';

// Nearest edge of a rect to a point — used to pick the split direction.
function nearestEdge(rect: DOMRect, x: number, y: number): Edge {
  const d = {
    left: (x - rect.left) / rect.width,
    right: (rect.right - x) / rect.width,
    top: (y - rect.top) / rect.height,
    bottom: (rect.bottom - y) / rect.height,
  };
  const min = Math.min(d.left, d.right, d.top, d.bottom);
  if (min === d.left) return 'left';
  if (min === d.right) return 'right';
  if (min === d.top) return 'top';
  return 'bottom';
}

// Renders a binary split-tree. Drag-and-drop docking:
//   - drop on a leaf's HEADER (tab row) → tab into that leaf (reorder on a
//     tab, append on the empty space);
//   - drop on a leaf's BODY → split that leaf in the nearest-edge direction.
export function Dock<Id extends string>(props: Props<Id>) {
  const { node, path = [] } = props;
  if (node.kind === 'leaf') {
    return <DockLeaf {...props} leaf={node} path={path} />;
  }
  return <DockSplit {...props} node={node} path={path} />;
}

function DockLeaf<Id extends string>({
  leaf,
  path,
  getPanel,
  closedPanels,
  onActivate,
  onClose,
  onAdd,
  onSplit,
  onReorder,
}: Props<Id> & { leaf: LeafNode<Id>; path: Side[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [splitEdge, setSplitEdge] = useState<Edge | null>(null);
  // x of the insertion line within .dock-tabs (offset coords), or null.
  const [insertX, setInsertX] = useState<number | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const lastId = leaf.panels[leaf.panels.length - 1]!;
  const active = getPanel(leaf.active);

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

  const dragData = (e: DragEvent): { path: Side[]; id: Id } | null => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    return raw === '' ? null : (JSON.parse(raw) as { path: Side[]; id: Id });
  };
  const hasDrag = (e: DragEvent): boolean =>
    e.dataTransfer.types.includes(DRAG_MIME);

  const onTabDragStart =
    (id: Id) => (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ path, id }));
      e.dataTransfer.effectAllowed = 'move';
    };

  // Header: hovering a tab → insertion line at its near edge (the exact
  // boundary, computed from offsets so it never shifts with borders).
  const onTabDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    setInsertX(before ? el.offsetLeft : el.offsetLeft + el.offsetWidth);
  };
  const onTabDrop =
    (targetId: Id) => (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      setInsertX(null);
      const d = dragData(e);
      if (d !== null) onReorder(path, targetId, before, d.id, d.path);
    };

  // Header empty space → insertion line after the last tab; drop appends.
  const onTabsDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tabs = e.currentTarget.querySelectorAll<HTMLElement>('.dock-tab');
    const last = tabs[tabs.length - 1];
    setInsertX(last !== undefined ? last.offsetLeft + last.offsetWidth : 0);
  };
  const onTabsDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setInsertX(null);
    const d = dragData(e);
    if (d !== null) onReorder(path, lastId, false, d.id, d.path);
  };

  // The tab strip scrolls horizontally but hides its scrollbar, and a
  // mouse wheel only emits vertical deltas — map them onto scrollLeft so
  // wheeling over the tabs scrolls them (VS Code behavior). No
  // preventDefault needed: nothing above the tab row scrolls vertically.
  const onTabsWheel = (e: WheelEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (e.deltaY !== 0 && el.scrollWidth > el.clientWidth) {
      el.scrollLeft += e.deltaY;
    }
  };

  // Body → split by nearest edge.
  const onBodyDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!hasDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const el = bodyRef.current;
    if (el !== null) {
      setSplitEdge(nearestEdge(el.getBoundingClientRect(), e.clientX, e.clientY));
    }
  };
  const onBodyDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setSplitEdge(null);
    }
  };
  const onBodyDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const edge = splitEdge;
    setSplitEdge(null);
    const d = dragData(e);
    if (d !== null && edge !== null) onSplit(path, edge, d.id, d.path);
  };

  return (
    <section className="dock-leaf">
      <div className="dock-tabrow">
        <div
          className="dock-tabs"
          onWheel={onTabsWheel}
          onDragOver={onTabsDragOver}
          onDragLeave={() => setInsertX(null)}
          onDrop={onTabsDrop}
        >
          {leaf.panels.map((id) => (
            <div
              key={id}
              className={`dock-tab${id === leaf.active ? ' active' : ''}`}
              draggable
              onDragStart={onTabDragStart(id)}
              onDragOver={onTabDragOver}
              onDrop={onTabDrop(id)}
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
                className="dock-icon-btn dock-tab-close"
                aria-label={`Close ${getPanel(id)?.title ?? id}`}
                title="Close panel"
                onClick={() => onClose(path, id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {insertX !== null && (
            <div className="dock-insert-line" style={{ left: insertX }} />
          )}
        </div>
        <div className="dock-tabrow-actions" ref={actionsRef}>
          <button
            type="button"
            className="dock-icon-btn dock-add"
            title="Add a panel"
            aria-label="Add a panel"
            disabled={closedPanels.length === 0}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Plus size={15} />
          </button>
          {menuOpen && closedPanels.length > 0 && (
            <div className="dock-menu dock-add-menu">
              {closedPanels.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="dock-menu-item"
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
      <div
        className="dock-leaf-body"
        ref={bodyRef}
        onDragOver={onBodyDragOver}
        onDragLeave={onBodyDragLeave}
        onDrop={onBodyDrop}
      >
        {splitEdge !== null && <div className={`dock-drop dock-drop-${splitEdge}`} />}
        {active?.fill ? (
          <div className="dock-leaf-fill">{active.body}</div>
        ) : (
          <div className="dock-leaf-scroll">{active?.body}</div>
        )}
      </div>
    </section>
  );
}

function DockSplit<Id extends string>({
  node,
  path,
  onResize,
  ...rest
}: Props<Id> & { node: SplitNode<Id>; path: Side[] }) {
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
