import { SaveButton as SaveButtonUi, useSaveFlash } from '@cuboidy/ui';
import type { LoadedSource } from '../../lib/types.js';
import { saveToFolder } from '../../lib/save.js';

interface Props {
  source: LoadedSource;
}

// In-place save button. Only renders when the source carries a
// FSA handle — i.e. Chrome/Edge drop or showDirectoryPicker. On browsers
// without FSA, the user instead uses Export → Download as .cuboidy.
//
// The three visible states and the success flash live in @cuboidy/ui's
// SaveButton / useSaveFlash. Errors surface as a window.alert — minimal
// but loud; a future Toast component could replace this.

export function SaveButton({ source }: Props) {
  const flash = useSaveFlash();

  // Hidden when there's no writeable handle. Synthetic folders and FF/
  // Safari folder loads fall into this branch — they must use Export.
  if (source.handle === undefined) return null;

  const handleSave = async () => {
    flash.setSaving();
    try {
      await saveToFolder(source);
      flash.flashSaved();
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(`Save failed: ${(e as Error).message}`);
      flash.reset();
    }
  };

  return (
    <SaveButtonUi
      state={flash.state}
      className="save-btn"
      onClick={() => void handleSave()}
    />
  );
}
