import {
  Eraser,
  MousePointer2,
  Move,
  Paintbrush,
  Rotate3d,
  SquarePlus,
  type LucideIcon,
} from 'lucide-react';
import type { PreviewTool } from '../lib/types.js';

interface Props {
  tool: PreviewTool;
  // Per-tool disable reasons (shown as the tooltip). Absent = enabled.
  disabled: Partial<Record<PreviewTool, string>>;
  onSetTool: (tool: PreviewTool) => void;
}

// The preview's tool-mode switch (docs/preview-editing-design.md §2.1):
// transform tools, then voxel tools behind a divider. Exactly one tool
// is active; 'select' is the safe default where nothing can mutate the
// model. Unavailable tools stay visible but disabled with the reason in
// their tooltip, same convention as the view-mode toggle.

interface ToolDef {
  id: PreviewTool;
  icon: LucideIcon;
  label: string;
}

const TRANSFORM_TOOLS: readonly ToolDef[] = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'move', icon: Move, label: 'Move' },
  { id: 'rotate', icon: Rotate3d, label: 'Rotate' },
];

const VOXEL_TOOLS: readonly ToolDef[] = [
  { id: 'attach', icon: SquarePlus, label: 'Add voxels' },
  { id: 'erase', icon: Eraser, label: 'Erase voxels' },
  { id: 'paint', icon: Paintbrush, label: 'Paint voxels' },
];

export function PreviewToolbar({ tool, disabled, onSetTool }: Props) {
  const renderTool = ({ id, icon: Icon, label }: ToolDef) => {
    const reason = disabled[id];
    return (
      <button
        key={id}
        type="button"
        className={tool === id ? 'active' : ''}
        aria-pressed={tool === id}
        disabled={reason !== undefined}
        title={reason ?? label}
        onClick={() => onSetTool(id)}
      >
        <Icon size={14} />
      </button>
    );
  };
  return (
    <div className="preview-toolbar" role="toolbar" aria-label="Preview tools">
      {TRANSFORM_TOOLS.map(renderTool)}
      <div className="tool-divider" />
      {VOXEL_TOOLS.map(renderTool)}
    </div>
  );
}
