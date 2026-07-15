# @cuboidy/editor

Web-based editor for Cuboidy voxel model packages: load, inspect, edit
and save a whole model — geometry, rig, palettes and animations — in
the browser.

## Run locally

```bash
# from the cuboidy repo root
cd ts
npm install            # installs all workspace deps
cd packages/core
npm run build          # editor depends on @cuboidy/core's compiled .d.ts
cd ../editor
npm run dev            # opens http://localhost:5173
```

For a production build:

```bash
npm run build          # output goes to ts/packages/editor/dist/
npm run preview        # serves dist/ on a local port
```

## What the editor does

**Loading** — drop (or pick) a model folder, a single `.cvox` file, or
a packed `.cuboidy` ZIP. Folder loads resolve the whole SPEC §6.9/§6.10
project: the manifest's `geometry` list, the external palette binding,
and external animation files. Load problems appear in the Console panel
and as red names in the Files tree.

**Views** — a dockable panel layout (drag tabs to split/rearrange) with
three 3D modes:

- **Cvox view** — every part at the origin, the literal `.cvox` reading
- **Rig view** — the assembled rest pose (manifest hierarchy, §7.7
  transforms including `pivot.rot`)
- **Anim view** — animation playback (loop-aware) plus the keyframe
  editor: per-attribute timeline lanes, marker drag with snapping,
  easing presets, keyframe copy/paste, clip create/rename/delete, and
  inline ⇄ external clip conversion

**Editing** — everything goes through one undo/redo history:

- Source text for any package file (cvox, manifest, palette, animation
  JSON) with debounced reparse; structural edits synchronously land any
  pending reparse first and refuse to run on unparseable text
- Part operations: create (with target-file picker), rename, delete,
  drag-and-drop reparenting, move between geometry files (voxel colors
  remapped between inline palettes)
- Palette: edit/add/delete colors, bind/unbind an external
  `palette.json`, externalize/inline
- Renames and deletes cascade atomically — a part rename rewrites the
  cvox declaration, manifest entries, and inline AND external animation
  tracks in one undo step

**Saving** — in-place folder writeback on Chrome/Edge (File System
Access API) or a ZIP download elsewhere; Export produces a packed
`.cuboidy`.

## Tests

```bash
npm run test:e2e       # Playwright (headless Chromium, boots vite on :5199)
```

The E2E suite covers multi-file project loading, the
reparse/structural-edit race fixes, undo consistency, and rendering
semantics (loop behavior, rest-pose parity between Rig and Anim views).

## Tech stack

- **Vite 6** — dev server + production bundler
- **React 19** — UI framework
- **react-three-fiber 9 + drei 10** — declarative React wrapper over
  Three.js. The `<Canvas>` / `<mesh>` / `<OrbitControls />` JSX is just
  Three.js scene graph in React component form
- **Three.js 0.170** — the underlying 3D engine (peer of r3f)
- **plain CSS** — no Tailwind / CSS-in-JS, kept simple for contributors
- **Playwright** — E2E tests

## Bundle size note

The production bundle is ~1.3 MB unminified, ~365 KB gzipped. Most of
this is Three.js. For a static site this is fine; if it ever needs to
shrink, swap to a smaller subset import or lazy-load the 3D canvas.
