import { FileDown } from 'lucide-react';
import type { PlacedInstance } from '../lib/scene.js';

// The scene's name and the files it can be loaded from or saved to. A
// scene lives in the library folder beside the models it references,
// because the library is the namespace its `model` keys resolve in.
export function SceneBar({
  name,
  files,
  onRename,
  onOpen,
  onSave,
  status,
}: {
  name: string;
  files: readonly string[];
  onRename: (name: string) => void;
  onOpen: (file: string) => void;
  onSave: () => void;
  status: string | null;
}) {
  return (
    <div className="scene-bar">
      <label className="field">
        <span className="field-label">scene</span>
        <input
          className="text-input"
          value={name}
          aria-label="Scene name"
          onChange={(e) => onRename(e.target.value)}
        />
      </label>
      <div className="scene-bar-row">
        {files.length > 0 && (
          <select
            aria-label="Open a scene"
            value=""
            onChange={(e) => {
              if (e.target.value !== '') onOpen(e.target.value);
            }}
          >
            <option value="">Open…</option>
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-sm" onClick={onSave}>
          <FileDown size={13} />
          Save scene
        </button>
      </div>
      {status !== null && <p className="hint">{status}</p>}
    </div>
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
