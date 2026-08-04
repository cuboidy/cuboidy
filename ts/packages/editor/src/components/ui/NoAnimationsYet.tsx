import { Plus } from 'lucide-react';

// The "no animations yet" empty state the anim viewport and the Timeline
// panel both show — one copy, so the wording and the create affordance
// cannot drift apart.
//
// One way in, deliberately: a model that ships a §6.3 clip file but
// references none gets that clip by creating one and then pointing its
// storage select (Timeline) at the file. Offering a second entry point
// here would mean a picker that fires on selection while showing no
// state — the shape this panel set just moved away from.
export function NoAnimationsYet({
  disabled,
  onCreateClip,
}: {
  disabled: boolean;
  onCreateClip: () => void;
}) {
  return (
    <>
      <p>This model has no animations yet.</p>
      <button
        type="button"
        className="btn btn-create"
        disabled={disabled}
        onClick={onCreateClip}
      >
        <Plus size={13} />
        Create animation
      </button>
    </>
  );
}
