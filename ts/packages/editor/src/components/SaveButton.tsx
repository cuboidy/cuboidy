import { useState } from 'react';
import type { LoadedSource } from '../lib/types.js';
import { saveToFolder } from '../lib/save.js';

interface Props {
  source: Extract<LoadedSource, { kind: 'folder' }>;
}

// In-place save button. Only renders when the folder source carries a
// FSA handle — i.e. Chrome/Edge drop or showDirectoryPicker. On browsers
// without FSA, the user instead uses Export → Download as .cuboidy.
//
// Three visible states: idle ("Save"), saving ("Saving…"), and a brief
// success flash ("✓ Saved") that decays back to idle after 2s. Errors
// surface as a window.alert — minimal but loud; future a Toast component
// could replace this.

export function SaveButton({ source }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Hidden when there's no writeable handle. Synthetic folders and FF/
  // Safari folder loads fall into this branch — they must use Export.
  if (source.handle === undefined) return null;

  const handleSave = async () => {
    setState('saving');
    try {
      await saveToFolder(source);
      setState('saved');
      window.setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(`Save failed: ${(e as Error).message}`);
      setState('idle');
    }
  };

  return (
    <button
      type="button"
      className="save-btn"
      onClick={handleSave}
      disabled={state === 'saving'}
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? '✓ Saved' : 'Save'}
    </button>
  );
}
