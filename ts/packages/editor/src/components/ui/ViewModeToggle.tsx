import { ViewToggle, type ViewMode, type ViewToggleItem } from '@cuboidy/ui';

interface Props {
  mode: ViewMode;
  rigAvailable: boolean;
  animAvailable: boolean;
  onChange: (mode: ViewMode) => void;
}

// The editor's three views, over the shared segmented control:
//   - Geometry view: parts at origin (geometry-file-faithful)
//   - Rig view:      parts at manifest positions (requires a cuboidy.json)
//   - Anim view:     animation playback + keyframe editing (requires a manifest)
// A view is disabled when its requirement is unmet; the tooltip explains why.
//
// The list is here rather than in @cuboidy/ui because it is the editor's:
// the workspace has no geometry view (a scene has no single geometry file
// to be faithful to) and offering it one would be offering a mode it
// cannot render.

export function ViewModeToggle({
  mode,
  rigAvailable,
  animAvailable,
  onChange,
}: Props) {
  const items: ViewToggleItem<ViewMode>[] = [
    { id: 'geometry', label: 'Geometry view' },
    {
      id: 'rig',
      label: 'Rig view',
      title: 'View parts placed by the manifest',
      ...(rigAvailable
        ? {}
        : { unavailable: 'Fix cuboidy.json to place parts by the rig' }),
    },
    {
      id: 'anim',
      label: 'Anim view',
      title: 'Play and edit the model’s animations',
      ...(animAvailable
        ? {}
        : { unavailable: 'This model defines no animations yet' }),
    },
  ];
  return (
    <ViewToggle
      value={mode}
      items={items}
      label="View mode"
      onChange={onChange}
    />
  );
}
