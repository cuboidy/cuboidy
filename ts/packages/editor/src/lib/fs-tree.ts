// The Files panel renders a directory tree, but a package IS a flat map of
// /-separated paths (SPEC §3): there is no on-disk directory entry to read.
// So the tree is derived from the path set every render, and lives here —
// pure, and the one piece of the Files panel worth testing directly.

export interface DirNode {
  dirs: Map<string, DirNode>;
  files: Array<{ path: string; name: string }>;
}

// `emptyDirs` are session-only draft folders: a folder the user created
// but has put no file in yet has no representation in the package, so the
// panel carries it separately and passes it here to keep it visible.
//
// Both inputs are sorted, so sibling order is deterministic and a diff of
// the rendered tree means something.
export function buildFsTree(
  paths: Iterable<string>,
  emptyDirs: Iterable<string> = [],
): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  const dirAt = (segments: string[]): DirNode => {
    let node = root;
    for (const seg of segments) {
      let child = node.dirs.get(seg);
      if (child === undefined) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    return node;
  };
  for (const dir of [...emptyDirs].sort()) {
    dirAt(dir.split('/'));
  }
  for (const path of [...paths].sort()) {
    const segments = path.split('/');
    const name = segments.pop()!;
    dirAt(segments).files.push({ path, name });
  }
  return root;
}

// Every directory a path set implies, as full paths. `includeSelf` counts
// a path as naming a directory itself (draft folders) rather than a file
// inside one.
export function dirsOf(
  paths: Iterable<string>,
  includeSelf = false,
): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    const segs = p.split('/');
    const upto = includeSelf ? segs.length : segs.length - 1;
    for (let i = 1; i <= upto; i++) dirs.add(segs.slice(0, i).join('/'));
  }
  return dirs;
}
