interface Props {
  label: string;
  // Package-relative paths, already filtered to the ones worth offering.
  files: readonly string[];
  disabled?: boolean;
  title: string;
  onPick: (path: string) => void;
}

// "Bring a file that already exists into the model" — the third move
// beside creating one and writing one out, offered by each panel that
// owns a kind of reference: the Palette panel for §7.4 palettes, the
// clip bar for §6.3 animations, the Parts panel for §6.9 geometry.
//
// A picker rather than a button because the operation has to name WHICH
// file. Reached from the owning panel, the KIND never has to be guessed
// — which is what the Files tree's one-size "load" button got wrong.
//
// Renders nothing when there is nothing to offer: an affordance for an
// empty list is a dead end, not a discovery.
export function FileRefPicker({
  label,
  files,
  disabled = false,
  title,
  onPick,
}: Props) {
  if (files.length === 0) return null;
  return (
    <label className="file-ref-picker">
      <span>{label}</span>
      <select
        // Always reads "Choose…": this is an action, not a stored value.
        // The result shows up as the reference itself, elsewhere.
        value=""
        disabled={disabled}
        title={title}
        onChange={(e) => {
          if (e.target.value !== '') onPick(e.target.value);
        }}
      >
        <option value="">Choose…</option>
        {files.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}
