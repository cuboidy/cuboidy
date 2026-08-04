import { Plus } from 'lucide-react';
import { FileRefPicker } from './FileRefPicker.js';

// The "no animations yet" empty state the anim viewport and the Timeline
// panel both show — one copy, so the wording and the create affordance
// cannot drift apart.
export function NoAnimationsYet({
  disabled,
  onCreateClip,
  clipFiles = [],
  onAddClipFile,
}: {
  disabled: boolean;
  onCreateClip: () => void;
  // Unreferenced §6.3 clip files sitting in the package — a model with
  // no animations may still ship the file that holds one.
  clipFiles?: readonly string[];
  onAddClipFile?: ((path: string) => void) | undefined;
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
      {onAddClipFile !== undefined && (
        <FileRefPicker
          label="Use clip file"
          files={clipFiles}
          disabled={disabled}
          title="Reference an animation file already in this package (SPEC §6.3). It joins the model under a name taken from the filename."
          onPick={onAddClipFile}
        />
      )}
    </>
  );
}
