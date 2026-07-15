import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';

interface Props {
  onResetLayout: () => void;
}

// The ⚙ Settings menu, sitting next to the brand on the left of the
// header. Home for view / workspace settings that aren't document
// actions — currently just "Reset layout" (restore the default panel
// arrangement). Kept distinct from the right-side document/session
// controls (Save / Export / Load another) so unlike concerns don't share
// a cluster. Closes on outside-click and Escape, mirroring ExportMenu.
export function SettingsMenu({ onResetLayout }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleReset = useCallback(() => {
    onResetLayout();
    setOpen(false);
  }, [onResetLayout]);

  return (
    <div className="settings-menu" ref={containerRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Settings"
        onClick={() => setOpen((o) => !o)}
      >
        <Settings size={16} />
      </button>
      {open && (
        <div className="menu settings-menu-items" role="menu">
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={handleReset}
          >
            Reset layout
          </button>
        </div>
      )}
    </div>
  );
}
