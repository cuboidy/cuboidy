import { leaf, split, type LayoutNode } from '@cuboidy/ui';

// The EDITOR's panel set and its default arrangement.
//
// These used to live in the shared layout module, which meant every
// consumer of the dock mechanism was handed the editor's list of panels
// and the editor's starting layout. The split-tree machinery is genuinely
// general; a panel set is not. It sat unnoticed while there was only one
// app, and became obvious the moment there were two.

// Tool panels sit on the sides; the source panels are the model-viewing
// surfaces — first-class dock tabs you can move, split and reorder.
export type ToolPanelId =
  | 'files'
  | 'model'
  | 'parts'
  | 'properties'
  | 'palette'
  | 'inspector'
  | 'console';
export type SourcePanelId = 'preview' | 'geometry' | 'manifest' | 'timeline';
// Dynamic per-file tabs (v0.7 multi-file packages): one panel per package
// file, keyed by its /-relative path. Opened from the Files tree; not in
// ALL_PANELS (closing one just removes it — reopen via the tree).
export type FilePanelId = `file:${string}`;
export type PanelId = ToolPanelId | SourcePanelId | FilePanelId;

export const filePanel = (path: string): FilePanelId => `file:${path}`;
export function filePanelPath(id: PanelId): string | null {
  return id.startsWith('file:') ? id.slice('file:'.length) : null;
}

// Every dockable panel. The leaf "+" menu offers any of these not
// currently placed anywhere, so a closed panel can always be reopened.
export const ALL_PANELS: PanelId[] = [
  'files',
  'model',
  'parts',
  'properties',
  'palette',
  'inspector',
  'preview',
  'geometry',
  'manifest',
  'timeline',
  'console',
];

// The panel a reopened one should appear beside: the editor's viewport.
export const MAIN_PANEL: PanelId = 'preview';

// Default layout (nested binary): left column = (Files with Model tabbed
// behind it — both project-wide) over (Parts over Properties); center
// column = the source panels (Preview/geometry/manifest as tabs) over the
// bottom leaf (Timeline with the Console tabbed behind it, VS Code style);
// right column = Palette over the Key Inspector (the keyframe editor's
// selection detail, kept near the timeline's right end). Realizes the IA:
// Parts/Properties adjacent, Palette separated from the rig, and the
// timeline docked under the viewport like a Premiere-style editor.
export const initialLayout: LayoutNode<PanelId> = split<PanelId>(
  'row',
  split<PanelId>(
    'col',
    { kind: 'leaf', panels: ['files', 'model'], active: 'files' },
    split<PanelId>('col', leaf<PanelId>('parts'), leaf<PanelId>('properties'), 0.4),
    0.25,
  ),
  split<PanelId>(
    'row',
    split<PanelId>(
      'col',
      { kind: 'leaf', panels: ['preview', 'geometry', 'manifest'], active: 'preview' },
      { kind: 'leaf', panels: ['timeline', 'console'], active: 'timeline' },
      0.68,
    ),
    split<PanelId>('col', leaf<PanelId>('palette'), leaf<PanelId>('inspector'), 0.55),
    0.78,
  ),
  0.2,
);
