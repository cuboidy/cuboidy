import { Box, Braces, File } from 'lucide-react';

// Per-file glyph for the Files tree. Folders carry NO icon (a caret is enough);
// files get one so types read at a glance.
//
// The extension used to carry this: `.cvox` was geometry, `.json` was the
// manifest, the palette or an animation clip. Now every model file is `.json`,
// so the caller — which knows the manifest — passes the role instead. The
// extension still resolves the cases the manifest says nothing about (md, txt,
// anything a user dropped in).
export type FileRole = 'geometry' | 'data';

export function fileIcon(name: string, role?: FileRole) {
  if (role === 'geometry') return <Box size={14} className="ficon-geometry" />;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'json':
      return <Braces size={14} className="ficon-json" />;
    default:
      return <File size={14} />;
  }
}
