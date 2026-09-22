# @cuboidy/ui

The editor chrome shared by the [Cuboidy](../../../README.md) model editor
and the scene workspace: a dock, a header, inputs, a transport, undo/redo,
the browser file pickers, and the stylesheet the three of them are drawn
with.

The line is what surrounds a 3D view, never what is inside one. The model
itself belongs to [`@cuboidy/three`](../three/README.md) and
[`@cuboidy/r3f`](../r3f/README.md), and **neither is a dependency here** —
the arrow points the other way. That is the point of the split: the chrome
should not pull a renderer in behind it, and a renderer should not need a
stylesheet.

It also knows nothing about a **document**. No loading, no saving, no
`LoadedSource`. An app whose unit is a scene of several models must not
inherit a type that assumes exactly one, which is why the editor's own
document state stayed in the editor.

## What is here

| | |
|---|---|
| `Dock`, `useDockLayout`, `layout.ts` | The split/tab layout both apps arrange their panels in, and the pure tree operations behind it |
| `AppHeader`, `HeaderGroup`, `HeaderDivider`, `UndoRedoGroup`, `SaveButton` | The title bar and what sits in it |
| `NumberInput`, `TextInput`, `InlineNameInput` | The typed fields, including the one that renames a thing in place |
| `Transport`, `VisibilityButtons`, `ViewportChrome` (`ToolBar`, `ToggleGroup`, `ViewOverlay`, …) | Playback, show/hide, and the overlays that float over a viewport without being in it |
| `history.ts`, `shortcuts.ts` | One undo reducer with coalescing and a cap, and the keyboard handler for it — including the IME and text-entry guards, which are the part a second implementation gets wrong |
| `fs/browser-fs.ts` | Directory pickers, `FileList` and drag-entry readers, nested writes, downloads. Both apps open a folder the same ways |
| `tokens.css` + the six stylesheets | The design system. `--bg-0` is also what `@cuboidy/r3f`'s viewport background reads, by name, with a fallback |
| `view-types.ts` | The editor's view vocabulary: `ViewMode`, `PreviewTool`, `VoxelEdit`, `SelectedKey`. The two types that describe what the 3D scene draws live in `@cuboidy/r3f` |

Consumed as TypeScript source by whichever app imports it; there is no build
step. `npm run typecheck` is the check.
