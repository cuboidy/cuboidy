import { pathBasename, pathDirname } from './source-ops.js';

// Naming rules for files and folders created or renamed in the Files
// tree. Pure — the tree composes them with its own state (the existing
// path/dir sets, session-draft folders, and its drag/move policy).

// Files the loader reads as text (and therefore the only ones worth
// creating in the editor) — the extension set of load-model's
// TEXT_FILE_RE, plus the no-`\` / no-`:` rule a new path must satisfy.
export const CREATABLE_RE = /^[^\\:]+\.(json|md|txt)$/i;

// What a new file is going to BE. Stated by the author, not inferred:
// every referenced file in a v0.9 package is `.json` (§8), so the name
// carries no signal about the kind. Creating used to guess — `anims/`
// meant a clip, `palette.json` a palette, every other `.json` geometry —
// so a palette named `colors.json` was born as a geometry file.
export type NewFileKind = 'geometry' | 'palette' | 'clip' | 'text';

export const NEW_FILE_KINDS: ReadonlyArray<{
  id: NewFileKind;
  label: string;
  // What the created file will contain, for the picker's tooltip.
  hint: string;
}> = [
  { id: 'geometry', label: 'Geometry', hint: 'A §7 geometry file with one empty part' },
  { id: 'palette', label: 'Palette', hint: 'A §6.10 palette file with one color' },
  { id: 'clip', label: 'Animation', hint: 'A §6.3 clip file, 1s and looping' },
  { id: 'text', label: 'Text', hint: 'A plain .md / .txt note, carried but not read' },
];

// A referenced file is `.json` by §8, so the three model kinds require
// it; a note is the `.md` / `.txt` case the package carries verbatim.
export function extensionFitsKind(name: string, kind: NewFileKind): boolean {
  const lower = name.toLowerCase();
  return kind === 'text'
    ? lower.endsWith('.md') || lower.endsWith('.txt')
    : lower.endsWith('.json');
}

export const validNewSegments = (name: string): boolean =>
  !name.startsWith('/') &&
  !name.includes('\\') &&
  !name.includes(':') &&
  !name.split('/').some((s) => s === '' || s === '.' || s === '..');

export function validateNewPath(
  path: string,
  takenPaths: ReadonlySet<string>,
  // Omitted by the rename path, which cannot change a file's kind.
  kind?: NewFileKind,
): boolean {
  return (
    CREATABLE_RE.test(path) &&
    validNewSegments(path) &&
    !takenPaths.has(path) &&
    (kind === undefined || extensionFitsKind(path, kind))
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
