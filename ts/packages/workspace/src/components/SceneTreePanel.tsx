import { useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Plug,
} from 'lucide-react';
import { InlineNameInput, VisibilityButtons } from '@cuboidy/ui';
import type { PlacedInstance } from '../lib/scene-resolve.js';
import type { PanelRow } from '../lib/scene-tree.js';

interface Props {
  rows: readonly PanelRow[];
  all: readonly PlacedInstance[];
  selected: string | null;
  hidden: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  // All at once, as the editor's Parts toolbar does. Peeling a scene down
  // to one model and back is the reason per-instance visibility exists,
  // and doing it a row at a time is the slow way to reach the same state.
  onShowAll: () => void;
  onHideAll: () => void;
  onRename: (from: string, to: string) => void;
  // Drop `id` onto a specific socket, or detach it (`target` null).
  onAttach: (
    id: string,
    target: { host: string; socket: string } | null,
  ) => void;
}

// The scene as a tree, with drag-to-attach.
//
// The editor's Parts tree in every visible respect — same row, caret,
// icon and name classes from @cuboidy/ui, same drag signals, same
// drop-to-unparent strip, same double-click to rename. They answer the
// same question (what carries what), so someone who has used one already
// knows this one.
//
// SOCKETS ARE ROWS. A guest hangs off a named socket, not off a model, so
// the tree says so — which makes an empty socket visible, makes changing
// which socket something uses a drag rather than a trip to another panel,
// and lets every instance keep the same icon whether or not it happens to
// be attached.
export function SceneTreePanel({
  rows,
  all,
  selected,
  hidden,
  onSelect,
  onToggleVisible,
  onShowAll,
  onHideAll,
  onRename,
  onAttach,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  const end = (): void => {
    setDragging(null);
    setDropTarget(null);
  };

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Hosts this drag may NOT land on: itself, and anything it already
  // carries — attaching to your own guest is the cycle setAttachment
  // refuses, and refusing it silently at the drop looks like a bug.
  const forbidden = new Set<string>();
  if (dragging !== null) {
    forbidden.add(dragging);
    const carried = (id: string): void => {
      for (const p of all) {
        if (p.instance.attach?.to === id && !forbidden.has(p.instance.id)) {
          forbidden.add(p.instance.id);
          carried(p.instance.id);
        }
      }
    };
    carried(dragging);
  }

  // A name is free if no OTHER instance has it.
  const nameFree = (from: string) => (name: string) =>
    !all.some((p) => p.instance.id !== from && p.instance.id === name);

  // Every instance in the scene, flattened past the socket rows.
  const ids = all.map((p) => p.instance.id);
  const anyHidden = ids.some((id) => hidden.has(id));
  const anyShown = ids.some((id) => !hidden.has(id));

  return (
    <>
      <div className="panel-toolbar">
        <VisibilityButtons
          anyHidden={anyHidden}
          anyShown={anyShown}
          onShowAll={onShowAll}
          onHideAll={onHideAll}
        />
      </div>
      {/* Only the tree scrolls. The toolbar is a sibling ABOVE this, so
          a long scene does not scroll it out of view and a wide row does
          not carry it sideways — which is what happened while the whole
          panel sat in the dock leaf's own scroller. */}
      <div className="panel-scroll">
      {/* `scene-tree-panel` carries no styling — `panel-list` supplies
          all of it — but it is the hook the e2e suite addresses the tree
          by, which is a use. */}
      <div className="panel-list scene-tree-panel">
      {rows.length === 0 ? (
        <p className="empty">Nothing in the scene yet.</p>
      ) : (
    <>
      <ul className="tree-list" role="tree">
        {rows.map((r) => (
          <Row
            key={r.key}
            row={r}
            depth={0}
            selected={selected}
            hidden={hidden}
            dragging={dragging}
            dropTarget={dropTarget}
            forbidden={forbidden}
            collapsed={collapsed}
            renaming={renaming}
            nameFree={nameFree}
            onToggle={toggle}
            onSelect={onSelect}
            onToggleVisible={onToggleVisible}
            onStartRename={setRenaming}
            onFinishRename={(from, to) => {
              setRenaming(null);
              if (to !== null) onRename(from, to);
            }}
            onDragStartId={setDragging}
            onDragOverKey={setDropTarget}
            onDropSocket={(host, socket) => {
              if (dragging !== null) onAttach(dragging, { host, socket });
              end();
            }}
            onDragEnd={end}
          />
        ))}
      </ul>
      {dragging !== null && (
        <div
          className={`scene-detach-zone${dropTarget === 'root' ? ' active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTarget('root');
          }}
          onDragLeave={() => {
            if (dropTarget === 'root') setDropTarget(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            onAttach(dragging, null);
            end();
          }}
        >
          Drop here to detach
        </div>
      )}
    </>
      )}
      </div>
      </div>
    </>
  );
}

interface RowProps {
  row: PanelRow;
  depth: number;
  selected: string | null;
  hidden: ReadonlySet<string>;
  dragging: string | null;
  dropTarget: string | null;
  forbidden: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  renaming: string | null;
  nameFree: (from: string) => (name: string) => boolean;
  onToggle: (key: string) => void;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onStartRename: (id: string) => void;
  onFinishRename: (from: string, to: string | null) => void;
  onDragStartId: (id: string) => void;
  onDragOverKey: (key: string) => void;
  onDropSocket: (host: string, socket: string) => void;
  onDragEnd: () => void;
}

function Row(props: RowProps) {
  const { row, depth, collapsed, onToggle } = props;
  const open = !collapsed.has(row.key);
  const hasChildren = row.children.length > 0;

  const caret = hasChildren ? (
    <button
      type="button"
      className="tree-caret-btn"
      aria-label={`${open ? 'Collapse' : 'Expand'} ${label(row)}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(row.key);
      }}
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </button>
  ) : (
    <span className="tree-caret-spacer" aria-hidden="true" />
  );

  return (
    <li
      className="tree-node"
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
    >
      {row.kind === 'instance' ? (
        <InstanceRow {...props} row={row} caret={caret} />
      ) : (
        <SocketRow {...props} row={row} caret={caret} />
      )}
      {hasChildren && open && (
        <ul className="tree-list" role="group">
          {row.children.map((c) => (
            <Row {...props} key={c.key} row={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function InstanceRow({
  row,
  depth,
  selected,
  hidden,
  dragging,
  renaming,
  nameFree,
  caret,
  onSelect,
  onToggleVisible,
  onStartRename,
  onFinishRename,
  onDragStartId,
  onDragEnd,
}: RowProps & {
  row: Extract<PanelRow, { kind: 'instance' }>;
  caret: React.ReactNode;
}) {
  const { instance, problem } = row.placed;
  const id = instance.id;
  const isRenaming = renaming === id;
  const isHidden = hidden.has(id);

  const onDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to begin a drag with no payload set.
    e.dataTransfer.setData('text/plain', id);
    onDragStartId(id);
  };

  const cls = [
    'tree-row',
    id === selected ? 'selected' : '',
    isHidden ? 'hidden' : '',
    dragging === id ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(id)}
    >
      {caret}
      {/* The SAME icon whether or not it is attached. What a row is does
          not change with where it sits — that is what the nesting says. */}
      <span className="tree-icon">
        <Box size={13} />
      </span>
      {isRenaming ? (
        <InlineNameInput
          initial={id}
          ariaLabel={`Rename ${id}`}
          validate={nameFree(id)}
          onCommit={(name) => onFinishRename(id, name)}
          onCancel={() => onFinishRename(id, null)}
        />
      ) : (
        <span
          className="tree-name"
          title="Double-click to rename"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartRename(id);
          }}
        >
          {id}
        </span>
      )}
      {/* Only a problem the tree cannot already show. A missing socket is
          marked on the socket row it made; this is for the rest, like a
          host that is not in the scene at all. */}
      {problem !== undefined && instance.attach === undefined && (
        <AlertTriangle size={12} className="tree-warn" aria-label={problem} />
      )}
      {/* The row's only trailing control. Removing an instance lives in
          the Properties panel, where the editor keeps Delete part and
          where you can see what you are about to lose — an × revealed on
          hover, a pixel from a toggle, is an × you hit by accident. */}
      <button
        type="button"
        className="tree-action"
        aria-label={`${isHidden ? 'Show' : 'Hide'} ${id}`}
        aria-pressed={isHidden}
        title={isHidden ? 'Show in the scene' : 'Hide in the scene'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible(id);
        }}
      >
        {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function SocketRow({
  row,
  depth,
  dragging,
  dropTarget,
  forbidden,
  caret,
  onDragOverKey,
  onDropSocket,
}: RowProps & {
  row: Extract<PanelRow, { kind: 'socket' }>;
  caret: React.ReactNode;
}) {
  // Only sockets take drops. Dropping on a host would have to guess which
  // of its sockets was meant, and the guess is visible right here.
  const blocked =
    dragging !== null && (forbidden.has(row.host) || !row.published);

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (dragging === null || blocked) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onDragOverKey(row.key);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (dragging === null || blocked) return;
    e.preventDefault();
    e.stopPropagation();
    onDropSocket(row.host, row.socket);
  };

  const cls = [
    'tree-row',
    'socket-slot',
    dropTarget === row.key ? 'drop-target' : '',
    blocked ? 'drop-forbidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {caret}
      <span className="tree-icon">
        <Plug size={13} className="icon-socket" />
      </span>
      <span className="tree-name socket-name">{row.socket}</span>
      {/* Which part actually carries it. The published name is the
          contract a scene uses; this is what you need when the socket is
          in the wrong PLACE and something has to be fixed in the model. */}
      {row.target !== undefined && (
        <span className="socket-target" title={`Resolves to ${row.target}`}>
          {row.target}
        </span>
      )}
      {!row.published && (
        <AlertTriangle
          size={12}
          className="tree-warn"
          aria-label={`${row.host} does not publish '${row.socket}'`}
        />
      )}
    </div>
  );
}

function label(row: PanelRow): string {
  return row.kind === 'instance' ? row.placed.instance.id : row.socket;
}
