import { useState, type DragEvent } from 'react';
import { AlertTriangle, Box, Plug, X } from 'lucide-react';
import type { PlacedInstance, SceneNode } from '../lib/scene.js';

interface Props {
  roots: readonly SceneNode[];
  all: readonly PlacedInstance[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  // Drop `id` onto `host` → attach to its first published socket, or
  // detach when `host` is null.
  onAttach: (id: string, host: string | null) => void;
}

// The scene as a tree, with drag-to-attach.
//
// Modelled on the editor's Parts panel, down to the drop-to-unparent
// strip, because it answers the same question — what is carried by what
// — and a person who has used one should not have to learn the other.
// The nesting IS the attachment: a socket join is otherwise visible only
// as two models touching, which is not something you can read.
export function SceneTreePanel({
  roots,
  all,
  selected,
  onSelect,
  onRemove,
  onAttach,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);

  const end = (): void => {
    setDragging(null);
    setDropTarget(null);
  };

  // Which rows this drag may NOT land on: itself, and anything it already
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

  // A host is only a target if it publishes something to attach TO.
  const publishes = (id: string): boolean =>
    Object.keys(
      all.find((p) => p.instance.id === id)?.model.manifest.sockets ?? {},
    ).length > 0;

  if (roots.length === 0) {
    return <p className="empty">Nothing in the scene yet.</p>;
  }

  return (
    <div className="scene-tree-panel">
      <ul className="scene-tree">
        {roots.map((n) => (
          <Row
            key={n.placed.instance.id}
            node={n}
            depth={0}
            selected={selected}
            dragging={dragging}
            dropTarget={dropTarget}
            forbidden={forbidden}
            canHost={publishes}
            onSelect={onSelect}
            onRemove={onRemove}
            onDragStartId={setDragging}
            onDragOverId={setDropTarget}
            onDropId={(host) => {
              if (dragging !== null) onAttach(dragging, host);
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
    </div>
  );
}

function Row({
  node,
  depth,
  selected,
  dragging,
  dropTarget,
  forbidden,
  canHost,
  onSelect,
  onRemove,
  onDragStartId,
  onDragOverId,
  onDropId,
  onDragEnd,
}: {
  node: SceneNode;
  depth: number;
  selected: string | null;
  dragging: string | null;
  dropTarget: string | 'root' | null;
  forbidden: ReadonlySet<string>;
  canHost: (id: string) => boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDragStartId: (id: string) => void;
  onDragOverId: (id: string) => void;
  onDropId: (host: string) => void;
  onDragEnd: () => void;
}) {
  const { instance, problem } = node.placed;
  const id = instance.id;
  const blocked =
    dragging !== null && (forbidden.has(id) || !canHost(id));
  const isTarget = dropTarget === id;

  const onDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to begin a drag with no payload set.
    e.dataTransfer.setData('text/plain', id);
    onDragStartId(id);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (dragging === null || blocked) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    onDragOverId(id);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (dragging === null || blocked) return;
    e.preventDefault();
    e.stopPropagation();
    onDropId(id);
  };

  const cls = [
    'scene-row',
    id === selected ? 'selected' : '',
    isTarget ? 'drop-target' : '',
    blocked ? 'drop-forbidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li>
      <div
        className={cls}
        style={{ paddingLeft: `${0.35 + depth * 0.85}rem` }}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <button
          type="button"
          className="scene-row-main"
          onClick={() => onSelect(id)}
        >
          {instance.attach === undefined ? (
            <Box size={13} className="scene-row-icon" />
          ) : (
            <Plug size={13} className="scene-row-icon attached" />
          )}
          <span className="scene-row-id">{id}</span>
          {instance.attach !== undefined && (
            <span className="scene-row-socket">{instance.attach.socket}</span>
          )}
          {problem !== undefined && (
            <AlertTriangle size={12} className="scene-row-warn" aria-label={problem} />
          )}
        </button>
        <button
          type="button"
          className="scene-row-remove"
          title={`Remove ${id} from the scene`}
          aria-label={`Remove ${id}`}
          onClick={() => onRemove(id)}
        >
          <X size={12} />
        </button>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <Row
              key={c.placed.instance.id}
              node={c}
              depth={depth + 1}
              selected={selected}
              dragging={dragging}
              dropTarget={dropTarget}
              forbidden={forbidden}
              canHost={canHost}
              onSelect={onSelect}
              onRemove={onRemove}
              onDragStartId={onDragStartId}
              onDragOverId={onDragOverId}
              onDropId={onDropId}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
