import { pathBasename, pathDirname } from './source-ops.js';

// Naming rules for files and folders created or renamed in the Files
// tree. Pure — the tree composes them with its own state (the existing
// path/dir sets, session-draft folders, and its drag/move policy).

// Files the loader reads as text (and therefore the only ones worth
// creating in the editor) — the extension set of load-model's
// TEXT_FILE_RE, plus the no-`\` / no-`:` rule a new path must satisfy.
export const CREATABLE_RE = /^[^\\:]+\.(json|md|txt)$/i;

export const validNewSegments = (name: string): boolean =>
  !name.startsWith('/') &&
  !name.includes('\\') &&
  !name.includes(':') &&
  !name.split('/').some((s) => s === '' || s === '.' || s === '..');

export function validateNewPath(
  path: string,
  takenPaths: ReadonlySet<string>,
): boolean {
  return (
    CREATABLE_RE.test(path) && validNewSegments(path) && !takenPaths.has(path)
  );
}

// A new folder name inside `dir`: segment rules, and free among files,
// existing directories and session drafts alike.
export function validateNewFolderName(
  dir: string,
  name: string,
  taken: {
    paths: ReadonlySet<string>;
    dirs: ReadonlySet<string>;
    drafts: ReadonlySet<string>;
  },
): boolean {
  const joined = dir === '' ? name : `${dir}/${name}`;
  return (
    validNewSegments(name) &&
    !taken.paths.has(joined) &&
    !taken.dirs.has(joined) &&
    !taken.drafts.has(joined)
  );
}

// A file rename edits only the filename (last segment) — moving between
// folders is drag-and-drop's job. The new name lands in the same
// folder, must be a valid creatable file, and keeps the file's type
// (every reference is .json — §8).
export function validateRenameName(
  oldPath: string,
  name: string,
  takenPaths: ReadonlySet<string>,
): boolean {
  if (name === pathBasename(oldPath)) return true;
  if (name.includes('/')) return false;
  const parent = pathDirname(oldPath);
  const newPath = parent === '' ? name : `${parent}/${name}`;
  if (!validateNewPath(newPath, takenPaths)) return false;
  const oldExt = oldPath.slice(oldPath.lastIndexOf('.')).toLowerCase();
  const newExt = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (oldExt === '.json') return newExt === oldExt;
  return true;
}

// A folder rename edits only the last path segment (no `/`) and lands on
// a free sibling path. The caller adds its move policy on top — since a
// folder rename re-prefixes every contained file, each must be movable.
export function validateRenameFolderName(
  dir: string,
  name: string,
  taken: { paths: ReadonlySet<string>; dirs: ReadonlySet<string> },
): boolean {
  if (name.includes('/') || !validNewSegments(name)) return false;
  const parent = pathDirname(dir);
  const newDir = parent === '' ? name : `${parent}/${name}`;
  return !taken.paths.has(newDir) && !taken.dirs.has(newDir);
}
