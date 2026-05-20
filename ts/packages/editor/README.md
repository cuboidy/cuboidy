# @cuboidy/editor

Web-based editor for Cuboidy voxel models. Stage A1 (viewer-only): drop a
`voxels.cvox` file into the browser, see the voxels rendered in 3D with
an orbit camera. Editing features (palette picker, voxel painting,
socket placement) are deferred to later stages — the editor grows
incrementally rather than landing as one giant Stage A3 commit.

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

## What the viewer currently does

- Drop a `.cvox` file (or click "Choose a file") to load it
- Renders every non-`.` voxel as a unit cube with palette color
- Multi-part files are laid out side-by-side along +X (manifest-aware
  positioning is a follow-up — manifest layout requires reading
  `cuboidy.json` for parent/position info)
- Orbit camera (left-drag rotate, right-drag pan, scroll zoom)
- Shows the file header (preserved on save per SPEC §7.11.1)
- Warns when inline comments are present (they are intentionally
  dropped, per the v0.6 comment policy)

## What it does NOT do yet

- Read `cuboidy.json` (manifest) → no hierarchy, no parent-relative offsets
- Visualize pivots or sockets
- Edit anything (paint voxels, move sockets, change palette, etc.)
- Save / export edited models
- Load packed `.cuboidy` ZIPs
- Render animations

These are tracked in the repo-root README roadmap.

## Tech stack

- **Vite 6** — dev server + production bundler
- **React 19** — UI framework (chosen for the future edit-UI stage; viewer
  alone could ship without a framework, but the migration cost at A2
  outweighs the framework overhead now)
- **react-three-fiber 9 + drei 10** — declarative React wrapper over
  Three.js. The `<Canvas>` / `<mesh>` / `<OrbitControls />` JSX is just
  Three.js scene graph in React component form
- **Three.js 0.170** — the underlying 3D engine (peer of r3f)
- **plain CSS** — no Tailwind / CSS-in-JS, kept simple for contributors

## Bundle size note

The production bundle is ~1.1 MB unminified, ~320 KB gzipped. Most of
this is Three.js. For a static site this is fine; if it ever needs to
shrink, swap to a smaller subset import or lazy-load the 3D canvas.
