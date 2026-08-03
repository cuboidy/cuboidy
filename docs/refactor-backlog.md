# Refactoring backlog — editor / workspace / core / ui

Consolidated from a three-way audit (2026-08-03): one pass over each of
`ts/packages/editor`, `ts/packages/workspace`, and `ts/packages/core` +
`ts/packages/ui`, cross-checked against each other. Line numbers are as of
this date and will drift as work lands — treat them as pointers, not anchors.

Organizing principle: each chunk is one cohesive concern, committable and
verifiable on its own (typecheck + tests for the mechanical ones, a
what-to-check list in the running app for anything behavioral).

Phases: **R0** deletions & mechanical fixes → **R1** small shared
extractions → **R2** big-file splits inside each app → **R3** core
consolidation & API surface. Later phases assume earlier ones but chunks
within a phase are independent.

---

## Bugs found along the way

Real defects, not style. Each gets fixed by (or during) the chunk noted.

| Bug | Where | Fixed by |
|---|---|---|
| Junk undo entries: three edit sites rebuild the document wrapper without the `next === present` identity check the history reducer depends on | `editor/src/lib/useAnimationEdits.ts:287, 327`, `usePaletteEdits.ts:139` | R2-a (`mutateSource`) |
| Render-phase side effect: `window.__scene = placed` runs during render (double-fires under StrictMode, never cleaned up) | `workspace/src/App.tsx:218` | R0-b |
| Playback re-renders everything at 60 fps: `renderPanel` closes over `time`, so every rAF tick rebuilds all seven panel bodies; `serializeScene(scene)` runs twice per frame (dirty check + source panel, both unmemoized) | `workspace/src/App.tsx:233, 349-550, 504` | R0-b |
| `.btn-sm` / `.btn` silently redefined by the editor over the shared stylesheet — the two apps' small buttons differ, exactly what tokens.css exists to prevent | `editor/src/styles.css:41-44` vs `ui/src/chrome.css:128-131` | R0-c |
| `activeColorIndex` survives a model swap (`handleReset` doesn't clear it) — wrong-but-valid initial paint color on the next model | `editor/src/App.tsx:188-192` | R0-a |
| O(instances × sockets × parts): `publishedSocketFrame` re-derives the whole rig per socket in two loops, despite core's own comment telling callers to hoist | `workspace/src/lib/drop.ts:64-66`, `InstanceGizmos.tsx:78-84` | R0-b |
| Divergent error codes for the same mistake: three separate Zod-issue→`CuboidyErrorCode` mappings disagree about `missing` handling | `core/src/manifest.ts:227-290`, `geometry/parse.ts:160-245`, `palette-file.ts:22-39` | R3-c |

---

## R0 — Deletions and mechanical fixes (zero behavior change)

Verification: `npm run typecheck && npm test` per package. No app-level
check needed except where noted.

### R0-a: editor quick wins

- **Delete `remapPartPalette`** (`editor/src/lib/source-ops.ts:126-155`) —
  verbatim copy of `core/src/geometry/transform.ts:114-141`, already exported
  from core. The editor already imports `duplicatePart`/`mirrorPart` from the
  same module.
- **Delete `normalizePath`** (`editor/src/lib/load-model.ts:548-559`) —
  byte-identical to core's exported `normalizeRefPath`. Used in 11 files;
  re-export under the local name or update imports.
- **PalettePanel stops re-implementing the palette codec**
  (`PalettePanel.tsx`): import `MAX_PALETTE` from core (line 53 duplicates
  `core/src/geometry/palette.ts:6`); export `indexToChar` and `parseHexColor`
  from core's barrel and drop the local copies (lines 257-277); move
  `computePaletteUsage` (240-255, pure voxel scan) out of the component.
- **Delete dead guards on required fields** — `LoadedSource` declares
  `folderName` / `files` / `manifestPath` required, yet 23 sites branch on
  them being absent. Worst: `FileTree.tsx:92-97` makes `isFolder`/`canEdit`
  statically true, so the flat-file fallback (544-559) and the `!canEdit`
  arm of `rowOps` (146-152) are unreachable, and `canEdit` is threaded
  through all 40 `DirChildrenProps` for nothing. Same pattern in
  `ExportMenu.tsx:59-108`, `useFileOps.ts` (6 sites), `App.tsx:492, 582,
  635`, others. ~70 lines net; the type checker proves each deletion.
- **Unused exports/imports**: drop `export` from `withRebuiltParts`,
  `geometryPaletteRefs`, `relativeRefFrom`, `withResolvedRefs`,
  `manifestJson` (all internal to `source-ops.ts`); `usePartEdits`'s returned
  `mutateManifest` (App never destructures it); unused imports
  `manifestGeometry` / `Part` / `KeyAttr` in `load-model.ts`,
  `source-ops.ts`, `types.ts`; dead `GEOMETRY_FILE` const
  (`load-model.ts:5`).
- **One `pathBasename`/`pathDirname` pair** — currently 5 implementations:
  `source-ops.ts:157-160`, `FileTree.tsx:248-255`, `PartTree.tsx:52-55`,
  `useFileOps.ts:225, 236-237`, `useFileTreeState.ts:112-113`.
- **Stale comments**: `save.ts:32-36` describes a pre-edit-phase save path
  that no longer exists; `PartProperties.tsx:71-73` says geometry fields are
  a follow-up (they shipped as `GeometryFields`).
- **`handleReset` clears `activeColorIndex`** (bug above).

### R0-b: workspace quick wins

- **Delete `ModelView.tsx`** (95 lines) — exported, imported nowhere in
  src/test/e2e.
- **Delete** `MAIN_PANEL` (`lib/panels.ts:63`, zero refs), the dead
  `exclude` param of `socketCandidates` (`lib/drop.ts:58-62`, only a test
  passes it), unused `ParseResult` export (`scene-file.ts:21-23`), the
  unreachable `library === null` arm of `renderPanel` (`App.tsx:352`), stale
  `handleSaveScene` dep (`App.tsx:539`).
- **Fix `window.__scene`** → `useEffect` with cleanup (bug above).
- **Memoize `serializeScene`** — one `useMemo(() => serializeScene(scene),
  [scene])` feeds both the dirty check and the source panel.
- **Stop per-frame Dock rebuilds** — split the clock-dependent panel out so
  `time` doesn't flow through `renderPanel`'s closure; memoize panel bodies.
- **Hoist rig derivation out of socket loops** — call
  `worldTransformsFor` once per instance, then `socketFrameOn` per socket
  (`drop.ts:64-66`, `InstanceGizmos.tsx:78-84`; also `SceneView.tsx:229`
  re-running `socketCandidates` when the memoized `candidates` exists).
- **Test fixture dedup** — `TOWER`/`GEM`/`LIBRARY` verbatim in
  `test/placement.test.ts`, `test/drop.test.ts`, near-verbatim in
  `test/scene.test.ts` → `test/fixtures.ts` (~80 lines).
- **Stale "stage 1" comments** (`App.tsx:68`).

### R0-c: core + ui quick wins

- **Delete dead code**: `buildScene` + `Voxel`
  (`core/src/render/scene.ts:27-32, 67-108`, superseded by
  `buildSceneFromParts`); `validateCrossFile`
  (`lint/cross-file.ts:237-245`) *plus* the legacy `input.parts ===
  undefined` branches only it reaches (63-75, 96-124); `angleOrNull`
  (`cli/gif-runner.ts:268-270`).
- **Delete both `toAnimPoses`-style converters**
  (`cli/gif-runner.ts:137-138`, `workspace/src/lib/scene.ts:363-367`) —
  `ReadonlyMap<string, Pose>` is directly assignable to
  `ReadonlyMap<string, AnimPose>`.
- **Collapse three `toHex`/`formatPalette` copies**
  (`cli/view-runner.ts:259-276`, `snap-runner.ts:192-205`,
  `query-runner.ts:256-273`) onto `serializeColor` via one
  `formatPaletteLegend(palette, { sep })`.
- **cvox-era renames** (no dual-format code survives, only names):
  `cvoxByName`→`shapesByName` (`cli/assemble.ts`),
  `ProjectInput.packageCvoxPaths`→`packageGeometryPaths`
  (`lint/cross-file.ts` + 2 call sites), `readCvox`→`readGeometryFile`
  (`cli/part-runner.ts`); fix the ghost reference to deleted `part.ts` in
  `geometry/transform.ts:8`.
- **CSS unification**: delete editor-local `.btn`/`.btn-sm` overrides;
  rename editor `.btn-icon` usages (PartProperties, Timeline) to ui's
  `.icon-btn` and delete the local rules (~30 lines); drop the undefined
  `tree-node` class in `SceneTreePanel.tsx`.
- **ui barrel trim** — drop internal-only exports: `Logo`,
  `TransformGizmo`, `findLeafPath`, `ToggleGroupItem`, `RigNode`, `Span`,
  `LeafNode`, `SplitDir`, `SplitNode`.
- **Small verbatim dupes in core**: `round6` (×2), `maxIndexIn` /
  `maxUsedIndexIn` (×2), `tryReadText` (×2), `MANIFEST_FILE` literal (×4
  across packages — export from `project.ts`), `PlacedPart` vs
  `OrientedPart` (make one extend the other).

---

## R1 — Small shared extractions (each < ~100 lines moved)

The apps were built one after the other and the second copied the first.
Each chunk here moves one concern into `@cuboidy/ui` or core and deletes
both copies. All have both-apps verification: the moved behavior must be
unchanged in editor *and* workspace.

- **R1-a: undo/redo plumbing → `ui/history.ts`**
  - `useUndoRedoShortcuts(undo, redo)` — byte-identical handlers at
    `workspace/src/lib/useSceneHistory.ts:61-88` and
    `editor/src/lib/useProjectDocument.ts:135-162` (same IME guard, same
    `closest(...)` selector; a third copy of the selector at
    `workspace/src/App.tsx:168-173`). Export `isTextEntryTarget` for the
    Delete-key guard.
  - `<UndoRedoGroup>` — duplicated header JSX
    (`workspace/App.tsx:569-590` vs `editor/App.tsx:979-1000`).
- **R1-b: `useDockLayout<Id>` → `@cuboidy/ui`** — the six
  `setLayout(l => l === null ? l : op(l, …))` closures + `closedPanels`
  memo, duplicated at `editor/App.tsx:461, 501-543, 664-670` and
  `workspace/App.tsx:99, 552-558, 670-698`. Bonus: the workspace's inline
  (unmemoized) arrows become memoized for free. ~85 + ~30 lines out.
- **R1-c: save affordance → ui** — `<SaveButton state onClick>`
  (`workspace/SceneActions.tsx:80-92` ≡ `editor/ui/SaveButton.tsx:46-58`)
  plus a `useSaveFlash()` for the 2000 ms saved→idle timer (×2).
- **R1-d: frame/rig math → core**
  - `composeFrames(parent, child)` in `core/socket-frame.ts` —
    `carryOnto` (`workspace/lib/scene.ts:372-382`) ≡ `carry`
    (`workspace/lib/drop.ts:79-85`) ≡ inline in `socketFrameOn`.
  - Export `clampToClip` from core beside `sampleAnimation` — the §6.7
    loop-clamp lives in `workspace/lib/clip.ts:12-21` and is open-coded at
    `editor/lib/useAnimationSession.ts:159-162`.
  - `pivotRotsOf(parts)` in `rig-transform.ts` — the pivot-rot map is
    built by hand at 4 sites (`socket-frame.ts:92-96`,
    `cli/assemble.ts:334-338`, `cli/gif-runner.ts:92-96`,
    `ui/rig.ts:35-39`).
  - `partsWorldAABB(parts, transforms)` — the 8-corner loop exists as
    `ui/rig.ts:34-66` (`computeWorldBounds`) and
    `workspace/lib/bounds.ts:19-59` (`modelBounds`); callers keep their own
    seed/floor policies.
  - `buildForest<T>(items, idOf, parentOf)` — cycle-safe forest builder
    duplicated as `workspace/lib/scene.ts:511-548` (`buildTree`) and
    `ui/rig.ts:126-167` (`buildRigTree`).
- **R1-e: gizmo primitives → `ui/scene/gizmo-primitives.ts`** —
  `srgbToLinear` (×4: `InstanceGizmos.tsx`, `thumbnail.ts`,
  `PartGizmos.tsx`, `PartMesh.tsx`), `AXIS_COLORS` (×2), `axisCross(len)`
  BufferGeometry (×2), `FRAME_COLOR`/`SOCKET_COLOR` literals (×3).
- **R1-f: browser file IO → shared non-React module** —
  `collectHandle`/`collect` are identical (`editor/lib/load-model.ts:185-199`
  ≡ `workspace/lib/open-folder.ts:52-66`), same `TEXT_FILE_RE`, same
  FileList reader with the same `||`-not-`??` comment; plus
  download-a-blob and FSA subfolder-write duplicated
  (`workspace/lib/save-scene.ts:47-79` vs `editor/lib/save.ts:108-167`).
  `FileTree.tsx:37`'s `CREATABLE_RE` should derive from `TEXT_FILE_RE`.
  **Open decision:** where this lives (see bottom).
- **R1-g: editor-internal small merges**
  - `clampRetime(...)` — the keyframe drag-clamp exists at
    `Timeline.tsx:546-559` and `useAnimationSession.ts:305-330` (the
    latter with `0.001` hardcoded thrice). Best home:
    `core/animation-edit.ts` next to `moveAttrKey`. Also fixes the layering
    inversion where `lib/useAnimationSession.ts:4` imports `SNAP_STEP` from
    a component — move `SNAP_STEP`/`GRID`/`snap` into `lib/`.
  - Extend `InlineNameInput` with a `trailing` slot + container-blur mode;
    delete `DraftPartRow` (`PartTree.tsx:441-545`, a 105-line fork of the
    83-line shared component).
  - One "no animations yet" empty state (`AnimationViewport.tsx:81-96` ≡
    `TimelinePanel.tsx:66-87`, third variant in `PreviewPanel.tsx:234-243`).
  - `<VisibilityToolbar>` — Show all / Hide all duplicated at
    `workspace/SceneTreePanel.tsx:106-125` and
    `editor/PartsPanel.tsx:79-96`.

---

## R2 — Big-file splits (one app at a time)

Behavioral risk is low-but-real here; each chunk needs an in-app check
pass. Existing coverage that must stay green: `editor/test/source-ops.test.ts`
(655 lines), `editor/test/load-model.test.ts` (583), workspace e2e
(`nesting.spec.ts`, `instances.spec.ts`, `library.spec.ts`).

- **R2-a: `mutateSource` — the editor's edit-hook prologue, once.**
  ~45 handlers across `usePartEdits` / `useAnimationEdits` /
  `usePaletteEdits` / `useFileOps` / `usePreviewEdits` open with the same
  six lines (editsBlocked gate → dispatchEdit → undefined guards →
  identity-preserving rewrap). ~150 lines of duplicated prologue/epilogue,
  and three sites get the rewrap wrong (see Bugs). One
  `mutateSource(tag, build)` / `mutateManifestOf(tag, build)` hook fixes
  the bug class permanently. **Do this before the other editor splits** —
  it shrinks every file the later chunks touch.
- **R2-b: editor `App.tsx` (1084 → ~400)**
  - `useDockLayout` (R1-b) removes 458-561 + 664-670.
  - `lib/derived-model.ts` — lines 286-456 are pure
    `(src: LoadedSource) => …` functions (`animManifest`, `clipRefs`,
    `partPalettes`, `paletteTarget`, …), directly testable.
  - `components/panels/registry.tsx` — `getPanel` (676-966, a 294-line
    12-arm switch, rebuilt unmemoized every render).
  - Diagnostics assembly (563-643) → own module.
- **R2-c: editor `FileTree.tsx` (951)** — split by responsibility:
  model classification (103-143, pure `LoadedSource` logic that partly
  re-derives `geometryPaletteRefs`) → `source-ops`; name validation
  (173-220) → `lib/file-name-rules.ts` (pure, testable); collapse the
  40-prop `DirChildrenProps` drill (575-640, spread through the recursion)
  into a row-ops context or single `ops` object.
- **R2-d: editor `source-ops.ts` (767)** — split into read / write /
  file-refs modules. Inside: factor `retargetManifestRefs(m, from, to |
  null)` — `renameFileInSource` (407-518) and `deleteFileInSource`
  (549-618) run the same three manifest rewrites with `to` vs `null`
  (~40 lines, and the two paths can no longer diverge). Same trick for the
  part-rename/part-delete animation loops
  (`usePartEdits.ts:546-562` vs 627-640 → `mapAnimationTracks`).
- **R2-e: workspace `App.tsx` (712 → ~150)** — extract `useLibrary()` +
  `<OpenFolderButton>` (118-137, 606-631), `useSceneDocument()` (231-310;
  cleanest cut — four states nothing else reads), `useDeleteKey`
  (162-181), derived view state (186-213, 328-347), the 201-line
  `renderPanel` switch (349-550) → panel components, header (562-634).
- **R2-f: workspace `SceneView.tsx` (717 → ~150)** — `ScenePanel`
  (chrome + transport, mirroring the editor's `PreviewPanel`/`VoxelScene`
  split), `scene/InstanceMesh.tsx` (550-659), `scene/cameras.tsx`
  (684-712), `lib/useDropResolver.ts` (136-157, 246-284), and
  `lib/render-probes.ts` — **67 lines (170-241) of E2E scaffolding
  currently ship in the production bundle**; extract behind one
  `installRenderProbes(...)` call a build flag can strip.
- **R2-g: workspace `lib/scene.ts` (548)** — three pure modules:
  `scene-doc.ts` (83-237, document ops), `scene-resolve.ts` (239-396,
  placement math), `scene-tree.ts` (398-548, panel/draw trees — `PanelRow.key`
  is literally a React key, this is view code). Zero-risk split; prerequisite
  for the R3 "move to core" decision.
- **R2-h: shared canvas scaffold** — `<ModelCanvas>` +
  `useSceneFraming()` in `ui/scene`: the frozen target/radius memos (with
  the same eslint-disable), Canvas/lights/gridHelper/OrbitControls JSX are
  duplicated at `editor/VoxelScene.tsx:432-450, 537-548` ≡
  `AnimationViewport.tsx:62-79, 99-120`, with a third variant at
  `workspace/SceneView.tsx:416-465`.
- **R2-i: pure voxel math out of React** — `resizeVoxels` and the
  stroke-refit (`usePreviewEdits.ts:190-293` — re-origins the part and
  compensates pivot + socket positions, currently untestable without
  mounting a hook; `PartProperties.tsx:417-434`) → `core/geometry/transform.ts`
  next to `mirrorVoxels`.

---

## R3 — Core consolidation & API surface

The chunks that change package boundaries. Higher review effort, mostly
low mechanical risk because the pure halves are already tested.

- **R3-a: one project resolver.** `editor/lib/load-model.ts:379-523`
  (`resolveProjectRefs` + `readPaletteRef`, ~115 lines) re-implements
  `core/project.ts:305-446` (`resolveProject` + `readPalette`) — same walk,
  same palette cache, same Zod validation and message formatting. They
  already diverge (the editor's `../` message). Add an
  `overrides?: ReadonlyMap<string, Geometry>` option to core's
  `resolveProject` for the live-edited AST, map diagnostics at the call
  site, delete the editor copy. Then move the rest of `load-model`'s pure
  half (226-573: `buildFolderResult`, `withResolvedPalette`,
  `isGeometryPath`, …) into core, leaving the browser IO adapter (32-224,
  incl. the §13 zip checks) in the editor.
- **R3-b: one lint composition.** `editor/lib/lint.ts:56-106` mirrors
  `core/cli/lint-runner.ts:137-198` (same sniff-every-json enumeration,
  same resolve→validate sequence, independently declared `<cross-file>`
  sentinel). Move into `core/lint/project-lint.ts` over
  `(manifest, files: ReadonlyMap<string,string>)`; CLI and editor become
  fs/memory adapters.
- **R3-c: one Zod→diagnostic mapping.** Three divergent copies (see
  Bugs). One `zod-diagnostic.ts` with `resultFromZodError(error, input,
  opts)`; `parseManifest` / `parseGeometry` / `parsePaletteFile` become
  three-liners. *Behavioral change:* error codes converge — snapshot the
  before/after on the test corpus.
- **R3-d: CLI dedup.** `cli/shell.ts` (`runCli(name, HELP_TEXT,
  parseArgs, run)`) — six entry files repeat the same arg loop, help/exit-2
  protocol, and `main().then(...)` tail; `parsePositiveInt` and a third hex
  parser duplicated between snap/gif. Split `cli/assemble.ts` (495):
  `read-package.ts` (fs staging, also used by `lint-runner`),
  `effective-palette.ts`, keep grid+bbox as `assemble.ts`.
- **R3-e: one parent-chain walk.** Four implementations with four failure
  policies (`manifest.ts:180-198` validation, `cli/assemble.ts:453-487`
  topo sort, `rig-transform.ts:135-179` loop→root,
  `ui/rig.ts:144-157` drop-edge). One `partHierarchy(parts)` returning
  `{order, roots, parentOf, cycles}`; validation reports cycles, renderers
  ignore them.
- **R3-f: shared face table.** `FACES` + the exposed-face triple loop
  duplicated between `mesh.ts:32-81` and `render/scene.ts:56-193` →
  `geometry/faces.ts` with `forEachExposedFace(part, cb)`.
- **R3-g: type hygiene.** One `Vec3Tuple` (currently `rig-transform.ts:15`
  readonly vs `animation.ts:142` mutable, same name, both public); rename
  `render/vec.ts`'s conflicting `Vec3`. Trim `core/index.ts` — 49 of 116
  exported names have no consumer outside core; split schemas/doc-types
  into a `@cuboidy/core/schema` subpath.
- **R3-h: ui rig API takes what core produces.** `ui/rig.ts` wants
  `(geometry, manifest)`, so the workspace synthesizes throwaway
  `Geometry` objects with a bogus file-level palette
  (`SceneView.tsx:669-680`; was ×2 before ModelView deletion). Flip the
  three entry points to `ReadonlyMap<string, ResolvedPart>` and let the
  editor (which holds a real `Geometry`) adapt. Also: make `RiggedParts`'
  `gizmos` prop optional (workspace passes an all-false constant); move
  editor-only vocabulary (`PreviewTool`, `VoxelEdit`, `TransformSubTarget`,
  `SelectedKey`, `PartGizmos`, …) from `ui/view-types.ts` back into the
  editor.
- **R3-i: shared tree components.** `SceneTreePanel` (429) and
  `PartTree` (546) share the CSS (`ui/tree.css`) but fork all the TSX:
  indent formula, caret button, collapse set, inline rename, eye toggle,
  drag wiring, root drop strip (~180 lines of shared shape). Extract
  `ui/tree/` (`<TreeRow>`, `<TreeCaret>`, `useTreeCollapse`,
  `<TreeUnparentZone>`). **Biggest win and riskiest chunk** — two live
  drag-and-drop surfaces with e2e coverage; do last.
- **R3-j (decision): scene domain → core?** After R2-g, `scene-doc.ts` +
  `scene-resolve.ts` + `scene-file.ts` are ~310 lines of pure domain logic
  reachable only from a React app. `core/socket-frame.ts:16-20` argues core
  should own host/guest join math *because* a future `cuboidy-snap
  --attach` CLI needs it — that CLI can't import the workspace. Options:
  move to `core/src/scene/` as an explicitly non-SPEC surface (the
  `SCENE_FORMAT`/`SCENE_VERSION` markers already exist), or a fourth pure
  package. `panelTree`/`drawTree` stay in the workspace either way.
- **R3-k: dev-build asymmetry.** `core/package.json` exports `./dist/`
  (requires a build step) while ui exports `./src/` — add a `development`
  conditional export or point core at src for dev.

---

## Open decisions

1. **Where does shared non-React browser code live?** (R1-f: directory
   collectors, blob download, FSA writes.) `@cuboidy/ui` drags in
   react+three; core would take on DOM types. Candidates: a `web/` subpath
   export on core, or a tiny fourth package (`@cuboidy/web-fs`).
2. **Does the scene domain move to core?** (R3-j.) Split first (R2-g);
   decide when a second consumer (CLI) is actually planned.
