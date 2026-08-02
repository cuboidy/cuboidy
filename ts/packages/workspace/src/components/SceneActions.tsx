import { useState } from 'react';
import { Check, FileJson, FilePlus2, Save } from 'lucide-react';
import { InlineNameInput } from '@cuboidy/ui';

interface Props {
  // The file this scene came from / was last saved to, relative to the
  // library root. Null for one that has never been saved.
  file: string | null;
  dirty: boolean;
  onNew: () => void;
  onSave: (file: string) => void;
  // 'saved' flashes briefly after a write in place.
  state: 'idle' | 'saving' | 'saved';
}

// The document controls, in the header where the editor keeps its own.
//
// They were in the Scene panel, mixed in with the list of scenes you
// might open instead. Which scene you are editing and what you can do to
// it belong to the session, not to a panel you can close — the editor
// puts save and load in the header for the same reason, and two windows
// of one product should not disagree about where Save lives.
export function SceneActions({ file, dirty, onNew, onSave, state }: Props) {
  const [savingAs, setSavingAs] = useState(false);

  return (
    <>
      <span className="header-doc">
        <FileJson size={13} className="header-doc-icon" />
        {savingAs ? (
          <InlineNameInput
            initial={file ?? 'untitled'}
            ariaLabel="Save scene as"
            // A path into a subfolder is fine — the library root is what
            // model keys resolve against, not the scene's own folder — so
            // the only thing to refuse is nothing at all.
            validate={(name) => name.trim() !== ''}
            onCommit={(name) => {
              setSavingAs(false);
              onSave(name);
            }}
            onCancel={() => setSavingAs(false)}
          />
        ) : (
          <>
            <span className="header-doc-name" title={file ?? undefined}>
              {file ?? 'untitled'}
            </span>
            {/* Unsaved changes. A dot rather than a word: it sits beside
                the name it is about, and says nothing when there is
                nothing to say. */}
            {dirty && (
              <span
                className="header-doc-dirty"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
            )}
          </>
        )}
      </span>

      <button
        type="button"
        className="icon-btn"
        title="New scene"
        aria-label="New scene"
        onClick={onNew}
      >
        <FilePlus2 size={16} />
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={savingAs || state === 'saving'}
        // A scene with no file has nothing to write back to, so Save has
        // to ask where — which is Save as.
        onClick={() => (file === null ? setSavingAs(true) : onSave(file))}
      >
        {state === 'saving' ? (
          'Saving…'
        ) : state === 'saved' ? (
          <>
            <Check size={14} />
            Saved
          </>
        ) : (
          <>
            <Save size={14} />
            Save
          </>
        )}
      </button>
      <button
        type="button"
        className="btn"
        disabled={savingAs}
        onClick={() => setSavingAs(true)}
      >
        Save as…
      </button>
    </>
  );
}
