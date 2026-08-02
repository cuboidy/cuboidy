import {
  Eraser,
  MousePointer2,
  Move,
  Paintbrush,
  Rotate3d,
  SquarePlus,
} from 'lucide-react';
import { ToolBar, type PreviewTool, type ToolBarItem } from '@cuboidy/ui';

interface Props {
  tool: PreviewTool;
  // Per-tool disable reasons (shown as the tooltip). Absent = enabled.
  disabled: Partial<Record<PreviewTool, string>>;
  onSetTool: (tool: PreviewTool) => void;
}

// The editor's tools, over the shared tool bar: transform tools, then
// voxel tools behind a divider. Exactly one is active; 'select' is the
// safe default where nothing can mutate the model. Unavailable tools stay
// visible but disabled with the reason in their tooltip, same convention
// as the view-mode toggle.

const TOOLS: readonly (Omit<ToolBarItem<PreviewTool>, 'unavailable'> | null)[] =
  [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'move', icon: Move, label: 'Move' },
    { id: 'rotate', icon: Rotate3d, label: 'Rotate' },
    null,
    { id: 'attach', icon: SquarePlus, label: 'Add voxels' },
    { id: 'erase', icon: Eraser, label: 'Erase voxels' },
    { id: 'paint', icon: Paintbrush, label: 'Paint voxels' },
  ];

export function PreviewToolbar({ tool, disabled, onSetTool }: Props) {
  const items = TOOLS.map((t) =>
    t === null ? null : { ...t, unavailable: disabled[t.id] },
  );
  return (
    <ToolBar
      value={tool}
      items={items}
      label="Preview tools"
      onChange={onSetTool}
    />
  );
}
