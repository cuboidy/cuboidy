import { Box, Braces, File } from 'lucide-react';

// Per-extension glyph for the Files tree. Folders carry NO icon (a caret is
// enough); files get one keyed on extension so types read at a glance:
//   .cvox = geometry, .json = manifest / palette / animation clip, else
// generic. (Externalized clips are `anims/<name>.json`, not a distinct
// `.anim` type — the editor only creates cvox/json/md/txt.)
export function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'cvox':
      return <Box size={14} className="ficon-cvox" />;
    case 'json':
      return <Braces size={14} className="ficon-json" />;
    default:
      return <File size={14} />;
  }
}
