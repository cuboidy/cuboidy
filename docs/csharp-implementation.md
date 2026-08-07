# C# implementation plan

Settled 2026-08-08, before any code exists. The decisions below were reached
against constraints that are invisible from inside this repository — Godot's
addon packaging rules, and how a consuming game's assemblies are laid out — so
they are written down rather than left to be rediscovered.

## What it is

`csharp/` is the format's second implementation: read a Cuboidy package off
disk, and hand back what a renderer needs — the resolved rig, rest poses,
animation sampled at a time, socket frames, and voxel geometry as vertex data.

It is engine-neutral. No `Godot.*`, no `UnityEngine.*`, no engine vector or
mesh type crosses its API; the caller uploads the arrays it is handed and the
library never touches a GPU resource. That is what lets one library serve
Godot, Unity and plain .NET tooling without a fork per engine.

## Scope

Ported from `ts/packages/core/`:

| TypeScript source | Why the C# side needs it |
|---|---|
| `manifest.ts`, `geometry/parse.ts`, `geometry/schema.ts`, `palette-file.ts` | reading a package at all |
| `project.ts` | resolving a package's references — the loader every consumer goes through |
| `rig-transform.ts` | rest pose, and composition down the part hierarchy |
| `animation.ts`, `easing.ts` | sampling a clip at a time |
| `socket-frame.ts` | where an attachment sits |
| `mesh.ts` | voxel grid to vertex data |

Deliberately not ported:

- `render/` — a software rasterizer, there to serve `cuboidy-snap` and
  `cuboidy-gif`. An engine brings its own.
- `cli/` — the inspection CLIs stay TypeScript. They are an author's tools,
  and the author already has Node.
- `lint/` — W/H warnings and project-level lint are authoring-time checks.
  Note the distinction from `project.ts`: a runtime **resolves** references
  (which geometry file, which palette entry, which part a track targets)
  because it cannot draw without them; it does not need to **report** on them.
  Resolution is in scope, reporting is not.
- `geometry/serialize.ts`, `animation-edit.ts` — writing and editing. This
  library reads.

The parse-level diagnostics *are* in scope, because they are what the fixtures
corpus measures — see "Done means" below.

## Layout

```
csharp/
  Cuboidy.sln
  Cuboidy/          the library; one NuGet package, `Cuboidy`
  Cuboidy.Tests/    NUnit; reads ../../fixtures/
```

One package, not two. Namespaces keep reading (`Cuboidy`) apart from runtime
(`Cuboidy.Runtime`), but a library this size gains nothing from a second
package and would pay for it with a version matrix between them.

NUnit rather than xUnit, to match what the first consuming project already
uses.

## Target frameworks

`netstandard2.1;net8.0`.

netstandard2.1 is there for Unity, which runs that profile from 2021.2
onward. A voxel model format that cannot be read from the largest engine on
the market is not the format this repository claims to be. net8.0 is there for
Godot's .NET build and for plain .NET tooling.

The cost of carrying both is bounded and known: an `IsExternalInit` polyfill so
`record` and `init` compile against netstandard2.1, and `System.Text.Json` as a
package reference rather than a framework type. Retrofitting netstandard2.1
onto a net8.0-only codebase later would instead mean a pass over every file —
which is why both targets are present from the first commit rather than added
when the first Unity user turns up.

## Dependencies

`System.Text.Json`, used through a source-generated `JsonSerializerContext`.
The generated form is not an optimization here: Unity's IL2CPP strips the
reflection the non-generated path relies on, so a reflection-based reader would
compile and then fail at runtime on precisely the platform netstandard2.1 was
added to reach.

Nothing else. The `schema/*.schema.json` files are generated artifacts for
editors and CI, not a runtime dependency — the C# reader validates
structurally as it reads, mirroring what the Zod schemas assert on the
TypeScript side, rather than pulling in a JSON Schema validator.

## Done means

Every file under `fixtures/` yields the diagnostic code its directory is named
after: `fixtures/geometry/wrong-arity/row-width.json` reports `wrong-arity`,
`fixtures/manifest/missing/name.json` reports `missing`, and so on. Thirty-
eight files today across `geometry/`, `manifest/` and `palette/`. That corpus
is the cross-implementation contract; passing it is what "a second
implementation exists" means here.

The C# side does not reimplement the mapping from a validation failure to a
code. `core/src/zod-diagnostic.ts` is the one place that decides, and its
branches are inference over Zod's issue shape — a hand-written validator
knows directly what a hand-written validator needs to know. Read §11.2's
table and that file's comments; port neither the branches nor the three
readers' older behaviour, which disagreed with the table and with each other.

`models/` is the positive half of the same contract: every shipped model —
fox, herbalist, knight, koi, owl, sword, windmill — loads clean.

The runtime half has no fixtures, so it is checked against TypeScript
numerically instead:

```
cuboidy-query <model> --transforms --sockets [--anim=<clip> --time=<s>]
```

`--transforms` prints every part's world transform and `--sockets` every
published frame (§6.12), each as `pos=x,y,z` and `quat=x,y,z,w` at six
decimals with `-0` folded to `0`. Compare **parsed doubles with a
tolerance**, not the strings: the two runtimes' trig can differ in the last
bits, and .NET renders negative zero as `-0` where JavaScript renders `0`.

This is what the criterion always meant and did not previously say. Until
`--transforms` existed, the only numbers the tool printed were six bbox
values and two range endpoints; everything else was palette characters read
off an axis-aligned voxel grid, which a part's rotation moves the pivot of
but does not turn the cells of. Measured against all seven models, a port
could drop `pivot.rot` entirely, or compose `q_pivot ⊗ q_rotation` the wrong
way round, without moving a single character of that output. There was also
no way to ask for a pose at all — `--anim` / `--time` are new, and without
them `animation.ts`, all twenty easing curves and `socket-frame.ts` sat
outside the contract completely.

## The Godot addon lives in a separate repository

`cuboidy-godot` — a Godot project at its root with `addons/cuboidy/` beside
it: an `EditorImportPlugin`, runtime node types, and a demo scene. It depends
on this library.

Separate, because the Asset Library builds its download from a repository URL
and a commit hash and offers no field for a subdirectory: `addons/` has to sit
at the root of whatever repository is submitted. Hosting it at the root of
*this* repository would turn the format's own repository into a Godot project
— and Godot's SDK compiles every `.cs` beneath a project directory, so
`csharp/` and its tests would be swept into the game assembly and have to be
excluded by hand.

The addon is C#, so it reaches only Godot's .NET build; the standard build and
web export are out of its range. That is a deliberate trade. The addon's first
real user is a C# game that will exercise the runtime path daily, and an addon
nobody runs rots faster than one with a narrow audience.

## Relation to the TypeScript implementation

TypeScript stays the reference. Where the two disagree and the spec is silent,
TypeScript is right and the spec gets the amendment.

Where the spec is **not** silent, the spec is right and TypeScript gets the
fix — before the port, not after. Left unstated, the rule above reads as
"TypeScript is right", and a pre-port audit found four classes of diagnostic
where the manifest reader disagreed with §11.2 while the geometry reader
agreed with it, plus inline geometry reporting a phase-3 violation ahead of a
phase-2 one against §11.8's explicit prohibition. Both are fixed. The value
of a second implementation is that it disagrees out loud; that only works if
disagreements with the spec are settled in the spec's favour rather than
inherited.

The C# side is a port, not a reinterpretation: keep the same decomposition and
the same names wherever C# allows, so that a future spec change can be applied
twice without deriving it twice.
