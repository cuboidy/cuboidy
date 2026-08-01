import { leaf, split, type LayoutNode } from '@cuboidy/ui';

// The WORKSPACE's panel set and its default arrangement.
//
// Nothing here is shared with the editor beyond the dock mechanism, and
// that is the point: the editor is closed over one model and its panels
// are about a document (files, palette, keyframes), while these are about
// an arrangement of several models. Trying to serve both from one panel
// list was rejected during design; keeping the lists apart is that
// decision holding.

export type PanelId =
  // The library the folder offers, the scene FILE, and the tree of what
  // is in it. The file bar and the tree are separate panels for the same
  // reason the editor keeps Files and Parts apart: one is about the
  // document, the other about what is inside it, and they are consulted
  // at different moments.
  | 'models'
  | 'scene'
  | 'tree'
  // The 3D view.
  | 'view'
  // What the selection is attached to, what it plays, and what it offers
  // in return.
  | 'attachment'
  | 'animation'
  | 'sockets'
  | 'problems';

export const ALL_PANELS: PanelId[] = [
  'models',
  'scene',
  'tree',
  'view',
  'attachment',
  'animation',
  'sockets',
  'problems',
];

export const PANEL_TITLES: Record<PanelId, string> = {
  models: 'Models',
  scene: 'Scene',
  tree: 'Instances',
  view: 'View',
  attachment: 'Attachment',
  animation: 'Animation',
  sockets: 'Published sockets',
  problems: 'Problems',
};

// The panel a reopened one appears beside: the 3D view is this app's
// main surface, as the preview is the editor's.
export const MAIN_PANEL: PanelId = 'view';

// Left column = the library over the scene built from it, so what you
// drag and where it lands are adjacent. Centre = the view. Right =
// attachment over what the selection publishes, which is the pair you
// read together when hooking one model onto another.
export const initialLayout: LayoutNode<PanelId> = split<PanelId>(
  'row',
  split<PanelId>(
    'col',
    leaf<PanelId>('models'),
    split<PanelId>('col', leaf<PanelId>('tree'), leaf<PanelId>('scene'), 0.62),
    0.42,
  ),
  split<PanelId>(
    'row',
    leaf<PanelId>('view'),
    split<PanelId>(
      'col',
      { kind: 'leaf', panels: ['attachment', 'animation'], active: 'attachment' },
      { kind: 'leaf', panels: ['sockets', 'problems'], active: 'sockets' },
      0.4,
    ),
    0.74,
  ),
  0.2,
);
