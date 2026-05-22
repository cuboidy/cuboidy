import { useCallback, useState, type ChangeEvent, type DragEvent } from 'react';
import type { LoadResult } from '../lib/types.js';
import {
  loadFromDirectoryEntry,
  loadFromDirectoryHandle,
  loadFromFileList,
  loadSingleFile,
} from '../lib/load-model.js';

interface Props {
  onLoad: (result: LoadResult) => void;
}

// Combined dropzone + Open buttons. Drop area auto-detects file vs
// folder; explicit "Open file" / "Open folder" buttons offer click-driven
// alternatives. On Chrome/Edge the FSA path is preferred (returns a
// writable handle); on Firefox/Safari we fall back to the legacy
// FileSystemEntry / webkitdirectory paths (read-only).

export function FileDropZone({ onLoad }: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const item = e.dataTransfer.items[0];
      if (item === undefined) return;
      const result = await processDroppedItem(item);
      if (result !== null) onLoad(result);
    },
    [onLoad],
  );

  const handlePickFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file !== undefined) onLoad(await loadSingleFile(file));
      // Clear the input so re-picking the same file re-fires onChange.
      e.target.value = '';
    },
    [onLoad],
  );

  const handlePickFolderLegacy = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files !== null && files.length > 0) {
        onLoad(await loadFromFileList(files));
      }
      e.target.value = '';
    },
    [onLoad],
  );

  const handleOpenFolderFSA = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) return;
    try {
      const handle = await (window as WindowWithFSA).showDirectoryPicker();
      onLoad(await loadFromDirectoryHandle(handle));
    } catch (e) {
      // User cancelled — silent. Real errors fall through to console.
      if ((e as Error).name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
  }, [onLoad]);

  const hasFsa = 'showDirectoryPicker' in window;

  return (
    <div
      className={`dropzone${isDragging ? ' dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="dropzone-icon">📁</div>
      <p className="dropzone-headline">
        Drop a cuboidy folder, <code>.cvox</code>, or <code>.cuboidy</code> file
      </p>
      <p className="dropzone-sub">or</p>
      <div className="dropzone-buttons">
        {hasFsa ? (
          <button type="button" className="open-btn" onClick={handleOpenFolderFSA}>
            Open folder
          </button>
        ) : (
          <label className="open-btn">
            <input
              type="file"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={handlePickFolderLegacy}
            />
            <span>Open folder</span>
          </label>
        )}
        <label className="open-btn">
          <input
            type="file"
            accept=".cvox,.cuboidy,text/plain,application/zip"
            onChange={handlePickFile}
          />
          <span>Open file</span>
        </label>
      </div>
      {!hasFsa && (
        <p className="dropzone-note">
          Your browser does not support direct folder writeback. Edits will be
          saved as a downloadable ZIP.
        </p>
      )}
    </div>
  );
}

// Dispatches a dropped DataTransferItem to the appropriate loader based
// on availability of FSA APIs and whether the item is a file or folder.
async function processDroppedItem(item: DataTransferItem): Promise<LoadResult | null> {
  // Chrome path: getAsFileSystemHandle gives a writable handle for
  // folders (used for in-place Save). File-kind handles are dispatched
  // via loadSingleFile so .cuboidy ZIPs are unpacked, .cvox loads raw.
  if ('getAsFileSystemHandle' in item) {
    try {
      const handle = await (item as DataTransferItemWithFSA).getAsFileSystemHandle();
      if (handle !== null) {
        if (handle.kind === 'directory') {
          return loadFromDirectoryHandle(handle as FileSystemDirectoryHandle);
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        return loadSingleFile(file);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('FSA-aware drop failed, falling back to entry API', e);
    }
  }
  // Fallback path (Firefox/Safari, or FSA failure): legacy
  // FileSystemEntry. Read-only — no folder writeback available.
  const entry = item.webkitGetAsEntry();
  if (entry === null) return null;
  if (entry.isDirectory) {
    return loadFromDirectoryEntry(entry as FileSystemDirectoryEntry);
  }
  const fileEntry = entry as FileSystemFileEntry;
  const file = await new Promise<File>((resolve, reject) =>
    fileEntry.file(resolve, reject),
  );
  return loadSingleFile(file);
}

// Minimal local type augmentations for APIs not yet in all TS lib.dom
// distributions (FSA is shipping but inclusion in lib.dom lags).
interface WindowWithFSA extends Window {
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

interface DataTransferItemWithFSA extends DataTransferItem {
  getAsFileSystemHandle(): Promise<FileSystemHandle | null>;
}
