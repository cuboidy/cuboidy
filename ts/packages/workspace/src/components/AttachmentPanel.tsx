import { Box } from 'lucide-react';
import { NumberInput } from '@cuboidy/ui';
import type { PlacedInstance } from '../lib/scene.js';

interface Props {
  placed: PlacedInstance | null;
  all: readonly PlacedInstance[];
  onAttach: (id: string, target: { to: string; socket: string } | null) => void;
  onPlace: (
    id: string,
    patch: { pos?: [number, number, number]; rot?: [number, number, number] },
  ) => void;
}

// Everything about the selected instance: what it is, what carries it, and
// where it sits.
//
// It was the Attachment panel, and only the attachment was editable —
// position and rotation could be reached solely by dragging a gizmo in the
// 3D view. That is fine for arranging by eye and useless for "two units
// up, exactly", which is most of what a numeric field is for.
//
// The one thing worth saying out loud is the SPACE. A placement is
// measured in the frame the instance belongs to: the scene for a free
// one, the socket for an attached one. Same three numbers, different
// meaning, so the label says which.
export function AttachProperties({ placed, all, onAttach, onPlace }: Props) {
  if (placed === null) return <p className="empty">No instance selected.</p>;
  const { instance } = placed;
  const attached = instance.attach !== undefined;

  // Every other instance whose model publishes at least one socket. An
  // instance cannot host itself; deeper cycles are refused by setAttachment.
  const hosts = all.filter(
    (p) =>
      p.instance.id !== instance.id &&
      Object.keys(p.model.manifest.sockets ?? {}).length > 0,
  );
  const host = all.find((p) => p.instance.id === instance.attach?.to) ?? null;
  const sockets = Object.keys(host?.model.manifest.sockets ?? {});

  const pos = instance.placement.pos;
  const rot = instance.placement.rot ?? [0, 0, 0];
  const setAxis = (key: 'pos' | 'rot', axis: number, value: number): void => {
    const next: [number, number, number] = key === 'pos' ? [...pos] : [...rot];
    // The 0.1 authoring grid the gizmo commits on. A typed 1.23456 landing
    // in the file is a number nobody chose.
    next[axis] = Math.round(value * 10) / 10;
    onPlace(instance.id, { [key]: next });
  };

  return (
    <div className="attach-props">
      {placed.problem !== undefined && (
        <p className="attach-problem">{placed.problem}</p>
      )}

      <div className="prop-identity">
        <Box size={13} className="prop-identity-icon" />
        <span className="prop-identity-id">{instance.id}</span>
        <span className="prop-identity-model">{instance.model}</span>
      </div>

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

      <div className="prop-group">
        <span className="field-label prop-group-label">
          {attached ? 'socket offset' : 'position'}
        </span>
        <div className="num-row">
          {(['x', 'y', 'z'] as const).map((axis, i) => (
            <NumberInput
              key={axis}
              label={axis}
              value={pos[i]!}
              step="0.1"
              onChange={(v) => setAxis('pos', i, v)}
            />
          ))}
        </div>
      </div>

      <div className="prop-group">
        <span className="field-label prop-group-label">rotation</span>
        <div className="num-row">
          {(['x', 'y', 'z'] as const).map((axis, i) => (
            <NumberInput
              key={axis}
              label={axis}
              value={rot[i]!}
              step="1"
              onChange={(v) => setAxis('rot', i, v)}
            />
          ))}
        </div>
      </div>

      <p className="hint">
        {attached
          ? 'Offset in the SOCKET’s axes, so it holds as the host turns. Rotation in degrees, ZXY (SPEC §4), about the model origin.'
          : 'Position in the scene. Rotation in degrees, ZXY (SPEC §4), about the model origin.'}
      </p>
    </div>
  );
}
