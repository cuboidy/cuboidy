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
  // The selected instance: what carries it, where it sits, what it plays.
  //
  // `attachment` is the id this panel was born with, kept because a saved
  // layout stores panel ids and renaming one would silently drop it from
  // anyone's arrangement. What it SHOWS grew: it is the Properties panel
  // now, with the placement editable as numbers rather than only by
  // dragging a gizmo.
  //
  // There was a Published sockets panel here too. The Instances tree grew
  // socket rows, which say the same thing in the place you are already
  // looking — and a second view of one fact is a question about which of
  // them is right. The one thing it knew that the tree did not, the
  // part:socket a published name resolves to, moved onto the row.
  | 'attachment'
  | 'animation'
  | 'problems'
  // The scene as it would be written to disk.
  | 'source';

export const ALL_PANELS: PanelId[] = [
  'models',
  'scene',
  'tree',
  'view',
  'attachment',
  'animation',
  'problems',
  'source',
];

export const PANEL_TITLES: Record<PanelId, string> = {
  models: 'Models',
  scene: 'Scene',
  tree: 'Instances',
  view: 'View',
  attachment: 'Properties',
  animation: 'Animation',
  problems: 'Problems',
  source: 'scene.json',
};

// The panel a reopened one appears beside: the 3D view is this app's
// main surface, as the preview is the editor's.
export const MAIN_PANEL: PanelId = 'view';

// Left column = the library over the scene built from it, so what you
// drag and where it lands are adjacent. Centre = the view. Right = what
// the selection is attached to and what it plays, over the scene as it
// would be written and anything wrong with the model behind it.
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
      { kind: 'leaf', panels: ['source', 'problems'], active: 'source' },
      0.4,
    ),
    0.74,
  ),
  0.2,
);
