import { FolderOpen } from 'lucide-react';
import type { Library } from '../lib/library.js';
import {
  canUseDirectoryPicker,
  openLibraryFromInput,
  openLibraryWithPicker,
} from '../lib/open-folder.js';

// The header's "Open folder" affordance, both routes: the FSA directory
// picker where the browser has one, the <input webkitdirectory> fallback
// where it doesn't. The caller only sees a Library or an error message.
export function OpenFolderButton({
  onAdopt,
  onError,
}: {
  onAdopt: (library: Library) => void;
  onError: (message: string) => void;
}) {
  const handlePick = async () => {
    try {
      onAdopt(await openLibraryWithPicker());
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user changed their mind
      onError((e as Error).message);
    }
  };

  return canUseDirectoryPicker() ? (
    <button type="button" className="btn" onClick={() => void handlePick()}>
      <FolderOpen size={14} />
      Open folder
    </button>
  ) : (
    <label className="btn">
      <FolderOpen size={14} />
      Open folder
      <input
        type="file"
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        {...({ webkitdirectory: '' } as any)}
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (files !== null && files.length > 0) {
            void openLibraryFromInput(files)
              .then(onAdopt)
              .catch((err: Error) => onError(err.message));
          }
        }}
      />
    </label>
  );
}
