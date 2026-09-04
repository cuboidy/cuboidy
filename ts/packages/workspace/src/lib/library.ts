import {
  MANIFEST_FILE,
  parseManifest,
  resolveProject,
  type InlineAnimation,
  type Manifest,
  type ResolvedPart,
} from '@cuboidy/core';

// The workspace's unit is a FOLDER OF MODELS, not a model.
//
// That is the whole difference from the editor, and it is why this is not
// the editor's loader with a loop around it. The editor opens one package
// and keeps every byte of it, because it is going to write those bytes
// back. The workspace opens a library, reads each package, and writes none
// of them — a scene references models; it does not own them. So a model
// here is the RESOLVED result and nothing else: no file map, no ASTs to
// re-serialize, no undo history over someone else's package.
//
// Everything below goes through core's resolveProject, so a model means
// here exactly what it means to the CLIs and to the editor.

import { SCENE_EXT } from './scene-file.js';


// One model the library offers. `dir` is the library key: the folder name,
// which is conventional (SPEC §3 says the manifest's `name` is
// authoritative) but is what the user picked the folder by.
export interface LibraryModel {
  dir: string;
  manifest: Manifest;
  // SPEC §6.13, keyed by the name the rig uses.
  parts: ReadonlyMap<string, ResolvedPart>;
  // §6.3 clips in both forms, flattened — a scene plays them by name and
  // has no reason to care which form the author wrote.
  animations: ReadonlyMap<string, InlineAnimation>;
  // Load-time complaints, shown against the model in the library list. A
  // model with problems still appears: seeing that it is broken is more
  // useful than it silently missing from the list.
  problems: string[];
}

export interface Library {
  // The folder the user opened, for display.
  name: string;
  models: LibraryModel[];
  // Directories that held no cuboidy.json. Not an error — a library may
  // hold anything — but worth reporting so a mistyped folder is visible.
  skipped: string[];
  // `*.scene.json` files anywhere under the library, by their path from
  // its root. Kept as TEXT: a scene is opened on demand, and one that
  // does not parse should say so when opened rather than stop the library
  // from loading.
  scenes: Map<string, string>;
  // Present when the folder was opened through the File System Access
  // API, which is what lets a scene be saved back in place. Absent
  // elsewhere (and in tests), where saving falls back to a download.
  handle?: FileSystemDirectoryHandle;
}

// Group a flat path→text map by its first segment, then read each group
// that has a manifest as a model. Paths are `/`-separated and relative to
// the folder the user opened, so `knight/cuboidy.json` means the `knight`
// model's manifest.
/**
 * `to`, written relative to the directory `from`. Both are library-root
 * paths with `/` separators; `from` may be `''` for the root itself.
 *
 * Leading `..` segments are what make a shared palette work: a model at
 * `tropalm/yeti` reaches `palette.json` at the library root by the same
 * `../../palette.json` its manifest already writes, and core's
 * `normalizeRefPath` keeps leading `..` rather than collapsing them, so the
 * key it looks up is the key produced here.
 */
function relativeTo(from: string, to: string): string {
  const a = from === '' ? [] : from.split('/');
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array<string>(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export function buildLibrary(
  name: string,
  files: ReadonlyMap<string, string>,
  handle?: FileSystemDirectoryHandle,
): Library {
  const byDir = new Map<string, Map<string, string>>();
  const scenes = new Map<string, string>();
  for (const [path, text] of files) {
    // A scene anywhere under the library, keyed by its path.
    //
    // ANYWHERE, not just at the root. A scene names its models by folder
    // name, so it needs a root to resolve them against — and that root is
    // the folder the user OPENED, which has nothing to do with where the
    // scene file itself sits. Requiring the root was a second rule that
    // bought nothing and turned a gallery of models into a folder with
    // scene files scattered through it.
    if (path.endsWith(SCENE_EXT)) {
      scenes.set(path, text);
      continue;
    }
    void text;
  }

  // A model is any directory holding a manifest, AT ANY DEPTH. Grouping by
  // the first path segment was the old rule and it made a namespaced library
  // unopenable: `Models/` produced one group called `tropalm` with no
  // manifest of its own, so seventeen models were reported as one skipped
  // folder. A loose manifest at the very root is still not a model -- §3
  // wants a folder, and the library IS that folder.
  const modelDirs: string[] = [];
  for (const path of files.keys()) {
    if (!path.endsWith(`/${MANIFEST_FILE}`)) continue;
    modelDirs.push(path.slice(0, -(MANIFEST_FILE.length + 1)));
  }

  // Every model sees the WHOLE library, keyed relative to itself, so a file
  // above it resolves: one `palette.json` shared by every model is the
  // arrangement this exists for, and copying it into each folder to satisfy
  // a loader is how palettes drift apart.
  for (const dir of modelDirs) {
    const group = new Map<string, string>();
    for (const [path, text] of files) group.set(relativeTo(dir, path), text);
    byDir.set(dir, group);
  }

  const models: LibraryModel[] = [];
  const skipped: string[] = [];
  // Directories with content but no manifest, reported so a mistyped folder
  // is visible. Only those that hold files directly: an ancestor of a model
  // is not a folder someone meant to be one.
  const withFiles = new Set<string>();
  for (const path of files.keys()) {
    // Scenes do not make a folder a candidate model: a library may keep a
    // whole folder of them, and calling that a skipped model is noise.
    if (path.endsWith(SCENE_EXT)) continue;
    const i = path.lastIndexOf('/');
    if (i > 0) withFiles.add(path.slice(0, i));
  }
  for (const d of [...withFiles].sort()) {
    if (!byDir.has(d) && !modelDirs.some((m) => d.startsWith(`${m}/`))) {
      skipped.push(d);
    }
  }
  for (const [dir, group] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    const model = readModel(dir, group);
    if (model === null) skipped.push(dir);
    else models.push(model);
  }
  return { name, models, skipped, scenes, ...(handle !== undefined && { handle }) };
}

function readModel(dir: string, files: Map<string, string>): LibraryModel | null {
  // SPEC §3: no manifest, no model. Silently skipping is right here — a
  // library folder may hold anything, and the caller reports the list.
  const manifestText = files.get(MANIFEST_FILE);
  if (manifestText === undefined) return null;

  const problems: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(manifestText);
  } catch (e) {
    return brokenModel(dir, `${MANIFEST_FILE}: ${(e as Error).message}`);
  }
  const mR = parseManifest(json);
  if (!mR.ok) return brokenModel(dir, `${MANIFEST_FILE}: ${mR.message}`);
  const manifest = mR.value;

  const project = resolveProject(manifest, files);
  for (const d of project.diagnostics) {
    problems.push(`${d.file}: ${d.diag.message}`);
  }
  for (const u of project.unresolved) problems.push(u.message);

  // §6.3 in both forms, flattened the way assemble.ts does it, so a scene
  // plays a clip by name without knowing where it was written.
  const animations = new Map<string, InlineAnimation>();
  for (const [clip, anim] of Object.entries(manifest.animations ?? {})) {
    if (typeof anim !== 'string') animations.set(clip, anim);
  }
  for (const [clip, rec] of project.externalAnims) animations.set(clip, rec.anim);

  return { dir, manifest, parts: project.parts, animations, problems };
}

// A model whose manifest did not parse still gets a row, so the library
// shows that the folder is there and wrong rather than pretending it is
// not there at all.
function brokenModel(dir: string, problem: string): LibraryModel {
  return {
    dir,
    manifest: { name: dir, parts: [] } as unknown as Manifest,
    parts: new Map(),
    animations: new Map(),
    problems: [problem],
  };
}
