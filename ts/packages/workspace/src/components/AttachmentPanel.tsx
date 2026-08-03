import { NumberInput, TextInput } from '@cuboidy/ui';
import type { PlacedInstance } from '../lib/scene-resolve.js';

interface Props {
  placed: PlacedInstance | null;
  all: readonly PlacedInstance[];
  onAttach: (id: string, target: { to: string; socket: string } | null) => void;
  onRename: (from: string, to: string) => void;
  onPlace: (
    id: string,
    patch: { pos?: [number, number, number]; rot?: [number, number, number] },
  ) => void;
  // Here rather than on the tree row, matching the editor's Delete part:
  // a destructive action belongs in the panel that shows you what it is
  // about to take, not behind a hover on a list.
  onRemove: (id: string) => void;
}

// Everything about the selected instance: what it is, what carries it, and
// where it sits.
//
// It was the Attachment panel, and only the attachment was editable —
// position and rotation could be reached solely by dragging a gizmo in the
// 3D view. That is fine for arranging by eye and useless for "two units
// up, exactly", which is most of what a numeric field is for.
//
// A placement is measured in the frame the instance belongs to: the scene
// for a free one, the socket for an attached one. Same three numbers,
// different space — said by the LABEL ("position" / "socket offset")
// rather than by a paragraph underneath. A panel of fields that also
// explains the format is a panel you read once and then look past.
export function AttachProperties({
  placed,
  all,
  onAttach,
  onRename,
  onPlace,
  onRemove,
}: Props) {
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

      {/* Click the name to rename, as the editor's part inspector does.
          The tree can rename too — same as the editor, where a part can be
          renamed from either — because whichever one you happen to be
          looking at should be the one that works. */}
      <div className="prop-identity">
        <div className="prop-identity-name">
          <TextInput
            value={instance.id}
            ariaLabel="Instance name"
            validate={(name) =>
              name === instance.id ||
              !all.some((p) => p.instance.id === name)
            }
            onCommit={(name) => onRename(instance.id, name)}
          />
        </div>
        <span className="prop-identity-model">{instance.model}</span>
      </div>

      <label className="field">
        <span className="field-label">attached to</span>
        <select
          value={instance.attach?.to ?? ''}
          // Nothing to attach to reads as a disabled control with the
          // reason on it, the same way an unavailable tool does. A picker
          // with one dead option and a paragraph under it said the same
          // thing at more length.
          disabled={hosts.length === 0 && instance.attach === undefined}
          title={
            hosts.length === 0 && instance.attach === undefined
              ? 'Nothing else in the scene publishes a socket'
              : undefined
          }
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

      <div className="prop-footer">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          title={`Remove ${instance.id} from the scene`}
          onClick={() => onRemove(instance.id)}
        >
          Remove from scene
        </button>
      </div>
    </div>
  );
}
