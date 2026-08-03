import { Eye, EyeOff } from 'lucide-react';

// The Show all / Hide all pair both tree panels put in their toolbar —
// the editor's Parts panel and the workspace's Instances panel rendered
// it verbatim.
export function VisibilityButtons({
  anyHidden,
  anyShown,
  onShowAll,
  onHideAll,
}: {
  anyHidden: boolean;
  anyShown: boolean;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!anyHidden}
        onClick={onShowAll}
      >
        <Eye size={13} />
        Show all
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!anyShown}
        onClick={onHideAll}
      >
        <EyeOff size={13} />
        Hide all
      </button>
    </>
  );
}
