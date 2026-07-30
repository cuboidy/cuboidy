import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LoadedSource } from '../lib/types.js';
import { downloadAsZip, downloadFile } from '../lib/save.js';

interface Props {
  source: LoadedSource;
}

// Dropdown-style Export menu. Always available when something is loaded;
// the visible items depend on what's actually exportable:
//   - geometry-only: just the geometry file
//   - folder + manifest: geometry / cuboidy.json / .cuboidy ZIP
//   - folder + no manifest: geometry + .cuboidy ZIP containing only it
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
    downloadFile(source.geometryFile.name, source.geometryFile.text);
    close();
  }, [source, close]);

  const handleDownloadManifest = useCallback(() => {
    if (source.kind === 'folder' && source.manifestFile !== undefined) {
      downloadFile(source.manifestFile.name, source.manifestFile.text);
    }
    close();
  }, [source, close]);

  const handleDownloadZip = useCallback(async () => {
    if (source.kind !== 'folder') return;
    const base = source.folderName.replace(/\.cuboidy$/i, '');
    await downloadAsZip(source, `${base}.cuboidy`);
    close();
  }, [source, close]);

  const isFolder = source.kind === 'folder';
  const hasManifest = isFolder && source.manifestFile !== undefined;

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
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={handleDownloadGeometry}
          >
            Download {source.geometryFile.name}
          </button>
          {hasManifest && (
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={handleDownloadManifest}
            >
              Download {source.manifestFile?.name ?? 'cuboidy.json'}
            </button>
          )}
          {isFolder && (
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={handleDownloadZip}
            >
              Download as .cuboidy (ZIP)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
