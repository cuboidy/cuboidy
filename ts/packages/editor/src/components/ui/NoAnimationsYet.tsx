import { Plus } from 'lucide-react';

// The "no animations yet" empty state the anim viewport and the Timeline
// panel both show — one copy, so the wording and the create affordance
// cannot drift apart.
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
