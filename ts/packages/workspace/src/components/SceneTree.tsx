import { AlertTriangle, Box, Plug, X } from 'lucide-react';
import type { PlacedInstance, SceneNode } from '../lib/scene.js';

interface Props {
  roots: readonly SceneNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

// The scene as a tree: free instances at the top, attached ones nested
// under whatever carries them. The nesting IS the attachment — it is the
// one place the arrangement is legible at a glance, which matters because
// a socket join is otherwise only visible as two models touching.
export function SceneTree({ roots, selected, onSelect, onRemove }: Props) {
  if (roots.length === 0) {
    return <p className="empty">Nothing in the scene yet.</p>;
  }
  return (
    <ul className="scene-tree">
      {roots.map((n) => (
        <TreeRow
          key={n.placed.instance.id}
          node={n}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  onSelect,
  onRemove,
}: {
  node: SceneNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { instance, problem } = node.placed;
  return (
    <li>
      <div
        className={`scene-row${instance.id === selected ? ' selected' : ''}`}
        style={{ paddingLeft: `${0.35 + depth * 0.85}rem` }}
      >
        <button
          type="button"
          className="scene-row-main"
          onClick={() => onSelect(instance.id)}
        >
          {instance.attach === undefined ? (
            <Box size={13} className="scene-row-icon" />
          ) : (
            <Plug size={13} className="scene-row-icon attached" />
          )}
          <span className="scene-row-id">{instance.id}</span>
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
          title={`Remove ${instance.id} from the scene`}
          aria-label={`Remove ${instance.id}`}
          onClick={() => onRemove(instance.id)}
        >
          <X size={12} />
        </button>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeRow
              key={c.placed.instance.id}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// What the selected instance is attached to, and to what. A scene's whole
// editable surface at this stage: which host, which PUBLISHED socket
// (§6.12 — an unpublished one is not offered, because it is not offered).
export function AttachProperties({
  placed,
  all,
  onAttach,
}: {
  placed: PlacedInstance | null;
  all: readonly PlacedInstance[];
  onAttach: (id: string, target: { to: string; socket: string } | null) => void;
}) {
  if (placed === null) return <p className="empty">No instance selected.</p>;
  const { instance } = placed;

  // Every other instance whose model publishes at least one socket. An
  // instance cannot host itself; deeper cycles are refused by setAttachment.
  const hosts = all.filter(
    (p) =>
      p.instance.id !== instance.id &&
      Object.keys(p.model.manifest.sockets ?? {}).length > 0,
  );
  const host = all.find((p) => p.instance.id === instance.attach?.to) ?? null;
  const sockets = Object.keys(host?.model.manifest.sockets ?? {});

  return (
    <div className="attach-props">
      {placed.problem !== undefined && (
        <p className="attach-problem">{placed.problem}</p>
      )}
      <label className="field">
        <span className="field-label">attached to</span>
        <select
          value={instance.attach?.to ?? ''}
          onChange={(e) => {
            const to = e.target.value;
            if (to === '') {
              onAttach(instance.id, null);
              return;
            }
            const target = all.find((p) => p.instance.id === to);
            const first = Object.keys(target?.model.manifest.sockets ?? {})[0];
            if (first !== undefined) onAttach(instance.id, { to, socket: first });
          }}
        >
          <option value="">— nothing (free in the scene) —</option>
          {hosts.map((p) => (
            <option key={p.instance.id} value={p.instance.id}>
              {p.instance.id}
            </option>
          ))}
        </select>
      </label>

      {instance.attach !== undefined && (
        <label className="field">
          <span className="field-label">socket</span>
          <select
            value={instance.attach.socket}
            onChange={(e) =>
              onAttach(instance.id, {
                to: instance.attach!.to,
                socket: e.target.value,
              })
            }
          >
            {/* A socket the host has stopped publishing still shows, so the
                scene explains itself rather than silently retargeting. */}
            {!sockets.includes(instance.attach.socket) && (
              <option value={instance.attach.socket}>
                {instance.attach.socket} (not published)
              </option>
            )}
            {sockets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      {hosts.length === 0 && instance.attach === undefined && (
        <p className="hint">
          Nothing else in the scene publishes a socket, so there is nowhere to
          attach this yet (SPEC §6.12).
        </p>
      )}
    </div>
  );
}
