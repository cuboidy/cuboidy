import { FileJson } from 'lucide-react';

interface Props {
  // Every scene in the library, by path from its root.
  files: readonly string[];
  // The one currently open, if any.
  current: string | null;
  onOpen: (file: string) => void;
}

// The scenes this library holds. Nothing else.
//
// It used to be this list plus a name field plus Save — three unrelated
// jobs in one box. Which scene you are editing and what you can do to it
// went to the header, where the editor keeps the same controls; what is
// left is a question with one answer, which is what a panel should be.
export function SceneList({ files, current, onOpen }: Props) {
  if (files.length === 0) {
    return (
      <div className="empty">
        <p>No scenes in this library yet.</p>
        <p className="hint">
          Arrange some models and save — a <code>.scene.json</code> anywhere
          under the folder shows up here.
        </p>
      </div>
    );
  }
  return (
    <ul className="scene-file-list">
      {files.map((f) => (
        <li key={f}>
          <button
            type="button"
            className={`scene-file${f === current ? ' current' : ''}`}
            aria-current={f === current ? 'true' : undefined}
            onClick={() => onOpen(f)}
          >
            <FileJson size={12} className="scene-file-icon" />
            <span className="scene-file-name">{f}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
