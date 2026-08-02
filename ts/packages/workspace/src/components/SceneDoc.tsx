import { useState } from 'react';
import { FileJson, Save } from 'lucide-react';
import { InlineNameInput } from '@cuboidy/ui';

interface Props {
  // The file this scene came from / was last saved to, relative to the
  // library root. Null for a scene that has never been saved.
  file: string | null;
  // Would saving change what is on disk?
  dirty: boolean;
  // Every scene in the library, by path.
  files: readonly string[];
  onOpen: (file: string) => void;
  onSave: (file: string) => void;
  status: string | null;
}

// Which scene you are editing, and the ones you could edit instead.
//
// A document bar, because a scene IS a document. It used to be a name
// field, an "Open…" dropdown and a Save button in a box — and the name
// field was the file name, which meant editing it and saving wrote a
// DIFFERENT file and left the original alone. Two identities for one
// document, with nothing obliging them to agree.
//
// So the file is the identity. Renaming is Save as…, which is a thing you
// decide to do rather than something that happens because you typed in a
// field.
export function SceneDoc({
  file,
  dirty,
  files,
  onOpen,
  onSave,
  status,
}: Props) {
  const [savingAs, setSavingAs] = useState(false);

  const commit = (name: string): void => {
    setSavingAs(false);
    onSave(name);
  };

  return (
    <div className="scene-doc">
      <div className="scene-doc-file">
        <FileJson size={13} className="scene-doc-icon" />
        {savingAs ? (
          <InlineNameInput
            initial={file ?? 'untitled'}
            ariaLabel="Save scene as"
            // A path into a subfolder is fine — the library root is what
            // model keys resolve against, not the scene's own folder — so
            // the only thing to refuse is nothing at all.
            validate={(name) => name.trim() !== ''}
            onCommit={commit}
            onCancel={() => setSavingAs(false)}
          />
        ) : (
          <>
            <span className="scene-doc-name" title={file ?? undefined}>
              {file ?? 'untitled'}
            </span>
            {/* Not saved, or saved and since changed. The one thing you
                cannot work out by looking at the scene itself. */}
            {dirty && (
              <span
                className="scene-doc-dirty"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
            )}
          </>
        )}
      </div>

      <div className="scene-bar-row">
        <button
          type="button"
          className="btn btn-sm"
          disabled={savingAs}
          // A scene with no file yet has nothing to write back to, so
          // Save has to ask where — which is Save as.
          onClick={() => (file === null ? setSavingAs(true) : onSave(file))}
        >
          <Save size={13} />
          Save
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={savingAs}
          onClick={() => setSavingAs(true)}
        >
          Save as…
        </button>
      </div>

      {status !== null && <p className="hint">{status}</p>}

      {files.length > 0 && (
        <>
          <p className="scene-doc-heading">in this library</p>
          <ul className="scene-file-list">
            {files.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  className={`scene-file${f === file ? ' current' : ''}`}
                  onClick={() => onOpen(f)}
                >
                  <FileJson size={12} className="scene-file-icon" />
                  <span className="scene-file-name">{f}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
