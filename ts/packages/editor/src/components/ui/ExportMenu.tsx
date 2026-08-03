import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LoadedSource } from '../../lib/types.js';
import { fileText, manifestText } from '../../lib/source-ops.js';
import { downloadAsZip, downloadFile } from '../../lib/save.js';

interface Props {
  source: LoadedSource;
}

// Dropdown-style Export menu: the primary geometry file, cuboidy.json,
// or the whole package as a .cuboidy ZIP.
//
// Closes on outside click and on Escape. The dropdown is positioned
// relative to the trigger button via CSS, so we don't need a portal.

export function ExportMenu({ source }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close. Mounted only while open to avoid
  // attaching idle listeners.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current !== null &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const handleDownloadGeometry = useCallback(() => {
    // Offered only when there IS a geometry file — an all-inline model
    // (§6.13) has nothing to download here but its manifest.
    const primary = source.primaryPath;
    if (primary === undefined) return;
    downloadFile(primary, fileText(source, primary) ?? '');
    close();
  }, [source, close]);

  const handleDownloadManifest = useCallback(() => {
    downloadFile(source.manifestPath, manifestText(source) ?? '');
    close();
  }, [source, close]);

  const handleDownloadZip = useCallback(async () => {
    const base = source.folderName.replace(/\.cuboidy$/i, '');
    await downloadAsZip(source, `${base}.cuboidy`);
    close();
  }, [source, close]);

  return (
    <div className="export-menu" ref={containerRef}>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Export
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu export-menu-items" role="menu">
          {source.primaryPath !== undefined && (
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={handleDownloadGeometry}
            >
              Download {source.primaryPath}
            </button>
          )}
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={handleDownloadManifest}
          >
            Download {source.manifestPath}
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={handleDownloadZip}
          >
            Download as .cuboidy (ZIP)
          </button>
        </div>
      )}
    </div>
  );
}
