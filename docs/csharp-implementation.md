# C# implementation plan

Settled 2026-08-08, before any code existed. The decisions below were reached
against constraints that are invisible from inside this repository — Godot's
addon packaging rules, and how a consuming game's assemblies are laid out — so
they are written down rather than left to be rediscovered.

**The port landed on 2026-08-10 and `csharp/` is the result.** This document
is no longer a plan; it is why the code looks the way it does, and it is still
where a change to either implementation gets thought through first. Every
scope decision below held, every hazard was hit, and where measuring one from
the C# side changed the answer the row says so (S6 is the one that did). What
the port added rather than found is recorded in the git log and in the source
comments, which is where a reader of `csharp/` will be standing.

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

Those ten are the modules with names worth arguing about. The actual closure
is **twenty-one files**, and the other eleven are not optional — an import
graph over `core/src` seeded from the ten reaches them, and reaches nothing
that is dropped:

| Also required | What it is |
|---|---|
| `geometry/types.ts` | the AST every module above produces or consumes, plus `Vec3` and `Vec3Tuple` |
| `geometry/palette.ts` | hex → `Color`, `MATTE`, and `MAX_PALETTE` |
| `geometry/voxel-row.ts` | the §7.4 alphabet (`charToIndex` / `indexToChar`) and `AIR`. Its `maxPaletteIndex` has no consumer inside the closure — it is called only from `cli/` and `lint/`, both dropped |
| `geometry/locate.ts` | a document path back to a line, for `parseGeometryText` |
| `result.ts`, `diagnostic.ts` | what a reader returns |
| `zod-diagnostic.ts` | the one §11.2 failure → code mapping. Read it, port neither its branches nor its Zod-shaped inference — see "Done means" |
| `identifier.ts`, `identifier-schema.ts` | §5 |
| `ref-path.ts` | §8 |
| `forest.ts` | `resolveHierarchy`, the one lenient parent policy; `rig-transform.ts` calls it |

Regenerate the list rather than trusting this table: walk the imports from
the ten seeds. The count has been wrong twice, once because
`zod-diagnostic.ts` was created after the table was written and once because
`forest.ts` was described as having no consumer inside core on the day
`rig-transform.ts` started calling it.

And four files the lists above leave unclassified, decided here:

- `num.ts` — **not ported**, with a caveat: `round6` is how `cuboidy-query`
  quantizes the numbers the parity check compares, so a harness that
  reimplements it must use `Math.Floor(n * 1e6 + 0.5) / 1e6` — JavaScript's
  `Math.round` is half-toward-`+∞` and C#'s is banker's.
- `geometry/transform.ts` — **not ported.** Mirror and duplicate are
  authoring operations.
- `json-schema.ts` — **not ported.** It builds a generated artifact for
  editors and CI; the C# reader validates structurally as it reads.
- `index.ts` — **not ported.** A barrel is a TypeScript packaging concern.
  It exports around 150 names, most of which have no consumer outside core
  and ten of which are Zod schema objects; do not read it as an API to
  reproduce.
- `resolveProject`'s **`overrides` option** — **not ported.** It lets a caller
  substitute a live geometry AST for a file's text, so the editor keeps
  rendering the last good shape while the file it came from does not parse.
  Its only caller anywhere is `editor/src/lib/load-model.ts`. A library has
  no mid-edit state to preserve, and it is the door through which an
  unvalidated `Part` reaches `buildMesh` — which is why `voxelAt` bounds-
  checks the arrays as well as the declared size.

Two things the scope lists said nothing about, decided here:

- **§13 packed `.cuboidy` archives — not ported, for now.** §13 carries
  MUST-level reader rules (strip a single top-level wrapper directory; reject
  an absolute, backslashed or `..`-containing entry path as `invalid-value`;
  `duplicate` for paths that normalise alike) and `core/` implements none of
  them — the only reader is `editor/src/lib/load-model.ts`, over `fflate`.
  A C# library would need a ZIP dependency, and this library has one
  dependency on purpose.

  Flagged rather than dismissed, because the addon's natural import unit is
  exactly one `.cuboidy` file: if the Godot `EditorImportPlugin` wants it,
  that is where it goes, over the framework's own `ZipReader`, with §13's
  path rules ported from the spec rather than from TypeScript (there is no
  TypeScript to port in core).

Deliberately not ported:

- `render/` — a software rasterizer, there to serve `cuboidy-snap` and
  `cuboidy-gif`. An engine brings its own.

  Including `render/camera.ts`, which is worth naming because it is pure
  math, depends on nothing but `render/vec.ts`, and is exported from the
  barrel with a comment explaining that it pulls no Node code into a bundle
  — so it reads like a candidate. It is not one: its `Angle` set is the
  contact-sheet convention `cuboidy-snap` renders, not a format rule, and an
  engine that draws the mesh already has a camera. The workspace's thumbnail
  view keeps using it as a TypeScript app.
- `cli/` — the inspection CLIs stay TypeScript. They are an author's tools,
  and the author already has Node.
- `lint/` — W/H warnings and project-level lint are authoring-time checks.
  Note the distinction from `project.ts`: a runtime **resolves** references
  (which geometry file, which palette entry, which part a track targets)
  because it cannot draw without them; it does not need to **report** on them.
  Resolution is in scope, reporting is not.

  That line is drawn in the types as well as in this paragraph:
  `ProjectDiagnostic` carries a `ResolutionDiagnostic`, which is a
  `Diagnostic` without `ruleId`. Port the narrow one — the eleven `W`/`H`
  identifiers are a lint vocabulary, and a library with no lint can never
  populate them.

  One rule crosses the line and §11.6 says which: a part name defined in two
  listed geometry files leaves the by-`name` lookup with no answer, so
  resolution itself fails. Refuse that model rather than binding the name to
  whichever file was read first.

  **Read `resolved`, not `complete`.** `ResolvedProject` carries two flags
  because they answer different questions. `complete` is
  `diagnostics.length === 0` — "reading the package went fine" — and it is
  what gates cross-file lint, since validating a half-read project buries the
  failure under its consequences. `resolved` is `complete` plus "every
  manifest part is bound to a shape and no name was ambiguous" — the question
  a runtime has: is there a shape for every part I am about to place?

  Only half of that is a §11.6 requirement. The spec says resolution itself
  fails for an ambiguous name, and an implementation MUST refuse to bind it.
  For a part no file defines it says only that the condition is reported, so
  a library is free to hand back the parts it did resolve. `resolved` covers
  both because a consumer asking "can I draw this" wants one answer, and the
  cost of the stricter reading is a flag rather than a refusal.

  This was very nearly a documented behavioural difference between the two
  implementations: an earlier draft of this paragraph told the C# side to
  refuse a model TypeScript loads, because TypeScript could not refuse it
  without gating off its own reporting. Two implementations disagreeing about
  which packages load is the one thing a second implementation exists to
  prevent, so the flag was split instead. `fixtures/project/` pins both
  cases.

  **Palette index range is phase-4 and is NOT ported**, deliberately. §11.6
  makes an index past the end of its resolved palette an error, and the check
  lives in `lint/cross-file.ts`; `project.ts` does no range checking at all.
  A runtime that only draws has the answer it needs from §7.4 — an index no
  palette defines renders as opaque magenta, which `mesh.ts` does — and does
  not need the report. Do not go looking for the check in the resolver.
- `geometry/serialize.ts`, `animation-edit.ts` — writing and editing. This
  library reads.

The parse-level diagnostics *are* in scope, because they are what the fixtures
corpus measures — see "Done means" below.

## Two things the port must WRITE, not translate

Everything above is a port. These two are new surface, and both were
invisible from the scope table because the TypeScript that does the job lives
in files the port drops. Neither is hard; both are easy to get subtly wrong
and then discover from a model that loads with one part missing.

### Loading a package off disk

`resolveProject` takes `files: ReadonlyMap<string, string>` and never touches
IO — which is exactly why a C# loader can reuse the decomposition, and also
why nothing in the ported set fills that map. Filling it is a **two-round**
walk, because §7.4 palette references live INSIDE geometry files and are not
visible until those have been read and parsed:

```
1  read <dir>/cuboidy.json                     — absent is `missing` (§11.5)
2  parseManifest                               — stop here if it fails
3  projectFilePaths(manifest)                  — §6.9 geometry + §6.3 animation
                                                 refs, already §8-normalised
4  read all of those into the map
5  resolveGeometries(manifest, files)          — parse round one
6  palettePathsOf(those geometries)            — §7.4 refs, now visible
7  read any of those not already in the map
8  resolveProject(manifest, files)             — the real call
```

`resolveGeometries` and `palettePathsOf` are exported for precisely this: step
5 is a throwaway parse whose only purpose is to discover step 6, and a package
is a handful of small files, so parsing twice is cheaper than threading a
callback through the resolver.

The reference does this in `cli/assemble.ts` and again in
`cli/lint-runner.ts`, both dropped. Read either; the sequence is the contract,
not the code.

Map keys are package-relative §8 paths as `projectFilePaths` returns them —
forward slashes, no leading `./`, no drive letters. `normalizeRefPath` is NOT
`Path.GetFullPath` (hazard H5, and it is worth re-reading before writing this
function).

### The entry point a consumer actually calls

The library's promise — the resolved rig, rest poses, a clip sampled at a
time, socket frames, and voxel geometry as vertex data — is four calls in a
required order, and TypeScript composes all four in exactly one place:
`cli/query-runner.ts`, which is dropped. So the shape of the API is a
decision the port makes rather than a translation it performs. What the order
has to be:

```
pivotRotsOf(resolved parts)                    → per-part pivot.rot
sampleAnimation(clip, time)                    → Map<part, Pose>      (omit for rest)
computeWorldTransforms(manifest.parts, pivotRots, poses)  → Map<part, Frame>
publishedSocketFrames(manifest, parts, poses)  → Map<name, Frame>     (§6.12)
buildMesh(part, part.palette)                  → vertex data, PART-LOCAL
localPointToWorld(v, pivot, pose.scale, world) → each vertex into world space
```

Two things fall out of that list and are easy to miss. `buildMesh` takes the
part's OWN palette — `ResolvedPart.palette` — not a merged one; merging is a
CLI concern that exists so an ASCII grid can spell every colour with one
character, and a renderer drawing per part never needs it. And the mesh comes
out in part-local space: `scale` and the world transform are applied by the
caller, per part, because scale does not propagate to children (§7.7).

Suggested shape, not prescribed: one `CuboidyModel` from the loader above,
with `RestPose()`, `Pose(clip, time)`, `SocketFrames(pose)` and
`BuildMesh(partName)`. Whatever it is called, it is the one piece of this
library with no reference implementation to check against — so it is the one
piece worth writing a test for before writing the code.

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

## Porting hazards

Places where the literal translation compiles and is wrong. Every one was
measured on the JavaScript side; the .NET halves are from documented
semantics, not from a run.

This list lived in a working file that was going to be deleted the day the
port started, which is the wrong home for the only record of why
`double.Parse` needs an argument.

**Numbers**

| # | hazard | consequence |
|---|---|---|
| N1 | `size.w / 2`, the §7.7 default pivot (`geometry/parse.ts:130`) | `z.number().int()` invites `int`, where `W / 2` is integer division: a width-3 part gets pivot `1` instead of `1.5` and every downstream coordinate is off by half a voxel, silently. `mesh.ts:187`'s `e.color.r / 255` is the same shape. |
| N2 | culture-sensitive parsing and formatting | `double.Parse(String)` uses `NumberStyles.Float \| AllowThousands` against the CURRENT culture: under `de-DE`, `double.Parse("1.5")` returns **15**. Every parse and every format in this library is `CultureInfo.InvariantCulture`. The two string→double conversions in the closure are both time keys, `animation.ts:126` and `:226`. |
| N3 | `round6` is `Math.round`, half toward `+∞` | C#'s `Math.Round` is banker's and `AwayFromZero` differs on negatives. The correct C# is `Math.Floor(n * 1e6 + 0.5) / 1e6`. |
| N4 | `round6` can return `-0` | JS `String(-0)` is `"0"`; .NET `(-0.0).ToString()` is `"-0"`. Normalise with `+ 0.0` before formatting. `cuboidy-query` already folds it. |
| N5 | `z.number().int()` accepts JSON `3.0` | SPEC §10: integer and decimal literals are interchangeable in any numeric field. A reader calling `GetInt32()` throws where one calling `GetDouble()` and testing `% 1 == 0` matches. Same for `duration` and every coordinate. |
| N6 | a JSON number outside double range | `1e400` parses to `Infinity` in JS and is rejected as `invalid-value`; `Utf8JsonReader.GetDouble()` throws `FormatException`. A coordinate that overflows is a diagnostic, not an exception. |
| N7 | `compareMaterials` and any `.sort((a,b) => a - b)` | Returning a DIFFERENCE from a `Comparison<T>` truncates to `int`: for 0..1 fields every pair compares equal and the sort silently does nothing. Core returns a sign — keep it that way on both sides. |
| N8 | `.sort()` is stable in JS since ES2019; `List<T>.Sort` is introsort and is not | Reachable for keyframes that bypassed validation, which `samplePart` documents itself as tolerating. Use `OrderBy` — but see S6 before sorting anything by string with it. |
| N9 | `easing.ts`'s `n1 * (u -= 1.5 / d1) * u + 0.75` | Ports verbatim only while `u` is a mutable value parameter. An `in double`, a readonly local, or "tidying" it into a temp changes the observable residue. §6.7 requires the expressions as written. **Do not tidy the easing formulas.** |

**Strings and encoding**

| # | hazard | consequence |
|---|---|---|
| S1 | .NET regex `$` also matches before a trailing `\n` | `"name": "head\n"` is rejected by TypeScript and accepted by .NET. Six sites: `identifier.ts:28`, `geometry/schema.ts:25`, `geometry/schema.ts:40`, `geometry/palette.ts:25`, `animation.ts:74`, and `ref-path.ts`'s generated pattern. Use `\z`. |
| S2 | `File.ReadAllText` strips a UTF-8 BOM by default | SPEC §9 forbids a BOM, and TypeScript enforces it only by `JSON.parse` throwing on `﻿`. The natural C# reader silently accepts what the reference rejects. Reject it explicitly. |
| S3 | `geometry/locate.ts` counts UTF-16 code units | A `Utf8JsonReader`-based port has byte offsets, so any non-ASCII earlier in the file shifts the reported line/column. §5 keeps identifiers ASCII, but a colour name or a path need not be. |
| S4 | `ToLower()` vs `ToLowerInvariant()` | The Turkish dotless ı. Anywhere case is folded — hex digits, preset names — must be invariant or ordinal. |
| S5 | `materialKey` interpolates three doubles into a string (`mesh.ts:70-71`) | Under `de-DE` `(0.5).ToString()` is `"0,5"`, the same character as the delimiter, so `metallic=0.5, roughness=0` collides with `metallic=0, roughness=5`; and `false.ToString()` is `"False"`. Port the bucket key as a value tuple or record, never a formatted string. |
| S6 | **string sorting is ordinal in JS and culture-sensitive in .NET** | `Array.prototype.sort()` with no comparator is specified to compare UTF-16 code units. `List<T>.Sort()`, `Array.Sort(string[])` and `OrderBy(x => x)` all use `Comparer<string>.Default`, i.e. `String.CompareTo`, which is culture-sensitive and differs across ICU on net8.0, NLS on older Windows, and `InvariantGlobalization=true` under IL2CPP. Measured under `ja-JP`, **every one** of `--mesh-faces`' 608 sorted lines for `models/sword` lands in a different position; with `StringComparer.Ordinal`, none do. Every observable sort is `StringComparer.Ordinal`. The face lines contain `-`, ` `, `,` and `=`, and §5 identifiers permit `-` and mixed case, so this is not hypothetical. **Re-measured from the C# side, and the mode matters more than the culture:** under **NLS** (`DOTNET_SYSTEM_GLOBALIZATION_USENLS=1`) 607 of the 608 lines move, for `ja-JP`, `de-DE`, `tr-TR` and `en-US` alike — the culture is almost irrelevant, the collation engine is not. Under **ICU**, which is the .NET 8 default, **none** of them move under any of those cultures. So on a stock net8.0 this hazard cannot be caught by a test: a port that used the default comparer would pass everything and then reorder its output on a machine running NLS. The rule stands because the ordinal comparer is what guarantees it, not because some culture happens to break it today. |

**Collections and ordering**

| # | hazard | consequence |
|---|---|---|
| C1 | `Map` / `Set` preserve insertion order; `Dictionary` / `HashSet` guarantee none | `project.ts:92`'s `[...new Set(out)]` fixes the geometry list order, which decides what every ordered output contains. Use ordered collections where order is observable. |
| C2 | time keys must be validated in DOCUMENT order | §6.6's "first key is `0.0`, strictly increasing" is a statement about the document. `System.Text.Json` reads document order, but `Dictionary<string, T>` enumeration order is explicitly unspecified — validating by enumerating a deserialized dictionary relies on undefined behaviour, on the one rule §6.6's decimal point exists to make cross-implementation. Walk with `Utf8JsonReader`, or keep an ordered list. |
| C3 | duplicate JSON object keys | JS is last-wins. Decide and state what the C# reader does, for time keys especially. |

**Types and `System.Text.Json`**

| # | hazard | consequence |
|---|---|---|
| T1 | three union-shaped fields have no source-generated form | `PaletteEntrySchema` (`geometry/schema.ts:84`) is string-or-object, `PaletteFieldSchema` (`:102`) is array-or-string, `AnimationSchema` (`animation.ts:160`) is object-or-string. `JsonSerializerContext` cannot generate a converter for `A \| B`; each needs a hand-written, reflection-free `JsonConverter<T>`. Reading is a `Utf8JsonReader` walk anyway, since the reader validates structurally as it reads — source-gen is for the shapes that are plain records. |
| T2 | `roughness`'s §7.4 default is **1**, and `default(double)` is 0 | `models/submersible/palette.json` has entries that set `emissive` and omit `roughness`. A DTO with a non-nullable `double Roughness` reads them as a mirror instead of a diffuse surface — and moves the entry in §7.4's normative material order. The three material fields are nullable in the DTO and defaulted after reading. `metallic` and `emissive` default to 0 and hide the bug. |
| T3 | netstandard2.1 polyfills | `IsExternalInit` for `record` / `init`, and `RequiredMemberAttribute` + `CompilerFeatureRequiredAttribute` + `SetsRequiredMembersAttribute` if `required` members are used — which `geometry/types.ts` argues for on the material fields. |
| T4 | structural typing has no C# counterpart | Core has been cleaned of the cases that mattered — one `Pose`, one `Vec3Tuple`, one `Frame` under two names, `Part` instead of a structural subset. Do not reintroduce them by "simplifying" a signature during translation. |

**Absence**

| # | hazard | consequence |
|---|---|---|
| A1 | JS reads past an array end as `undefined`; C# raises | The two that mattered are fixed: `mesh.ts`'s `voxelAt` treats an absent cell as AIR, and `samplePart` guards a non-finite time. The general rule stands — anywhere the TypeScript reads a container by index without a bounds check, decide what absent means before translating, and make it the same answer. |

## Done means

Every file under `fixtures/` yields the diagnostic code its directory is named
after: `fixtures/geometry/wrong-arity/row-width.json` reports `wrong-arity`,
`fixtures/manifest/missing/name.json` reports `missing`, and so on — 52
documents today across `geometry/`, `manifest/` and `palette/`, plus 2
packages under `project/`. That corpus is the cross-implementation contract;
passing it is what "a second implementation exists" means here.

`project/` is the odd one and is described in `fixtures/README.md`: §11.6 is
about a manifest and the files it references together, so those fixtures are
directories rather than documents, and what they assert is that the package
does not RESOLVE — `resolveProject(...).resolved === false` — which is the
half of §11.6 this library owns. The lint half is checked too, by the
TypeScript side only.

The count and the model list below are written as digits and as names on
purpose: `corpus-coverage.test.ts` reads this file and fails when either
stops matching what is on disk. Both were stale within a day of being
written, in the one document a porter reads to know when they are done.

The C# side does not reimplement the mapping from a validation failure to a
code. `core/src/zod-diagnostic.ts` is the one place that decides, and its
branches are inference over Zod's issue shape — a hand-written validator
knows directly what a hand-written validator needs to know. Read §11.2's
table and that file's comments; port neither the branches nor the three
readers' older behaviour, which disagreed with the table and with each other.

**Expect the two readers to disagree about the code on a document that holds
several errors at once, and do not chase it.** Measured over all 94 documents
under `models/` and `fixtures/` with the §7 reader: the two implementations
accept and reject exactly the same files, agree on the code for every one of
the twenty `fixtures/geometry/` documents, and differ on about thirty of the
rejected ones — every difference a manifest, palette file or animation clip
fed to the geometry reader, where a hand-written validator reaches the
unrecognized key first and Zod reaches the absent field first. §11.8 makes
that legal in as many words ("where several violations coexist *within* one
phase, which is reported is implementation-defined"), and it is why every
shared fixture holds exactly one error. What must NOT differ is the phase: a
phase-2 answer where the reference gives a phase-3 one is a real bug, and the
accept/reject split is what §11.6's W07 actually depends on.

`models/` is the positive half of the same contract: every shipped model —
fox, herbalist, knight, koi, orrery, owl, submersible, sword, windmill —
loads clean. Nine, and `submersible` is not an afterthought in that list: it
is the only one carrying §7.4 materials, and one of two with an alpha
channel, so a port that read the object form of a palette entry and threw the
material away passed the whole criterion without it.

The runtime half has no fixtures, so it is checked against TypeScript
numerically instead:

```
cuboidy-query <model> --transforms --sockets --mesh [--anim=<clip> --time=<s>]
```

- `--transforms` prints every part's world transform **and its §6.5 pose** —
  `pos=x,y,z quat=x,y,z,w scale=x,y,z visible=0|1`.
- `--sockets` prints every published frame (§6.12) as `pos` and `quat`.
- `--mesh` prints the §7.4 surface: a face count and a digest over the sorted
  face lines, plus one `mesh-part` line per part carrying that part's material
  list **in the normative order**, its opaque face count, and whether the
  opaque/translucent index split holds. `--mesh-faces` adds every face.

  What is deliberately free, and verified free: the ORDER faces come out in
  (they are sorted), the triangulation, the voxel walk, and **which corner a
  quad's four are listed from** — the corners are rotated to start at the
  lexicographically smallest, so the rectangle and its winding are compared
  and the table's starting index is not. What is NOT free, and this is a
  narrowing of what §7.4 permits: **a mesher that MERGES faces fails this
  criterion.** §7.4 allows greedy meshing and this comparison does not
  implement it, because an area-equivalence check costs more than it returns
  for a port whose stated goal is to keep the same decomposition. If a port
  wants to merge, it must do so above `BuildMesh`, not inside it.

  `opaque-faces` is counted from the faces, not from `opaqueIndexCount / 6`,
  which would have pinned the triangulation. `opaque-split` reports the
  property `opaqueIndexCount` exists for — every index below it belongs to an
  opaque material, every index above it to a translucent one — without
  pinning where the boundary falls.

All numbers are six decimals with `-0` folded to `0`. Compare **parsed
doubles with a tolerance**, not the strings: the two runtimes' trig can differ
in the last bits, and .NET renders negative zero as `-0` where JavaScript
renders `0`.

**The digest is a regression check, not a parity check.** It is FNV-1a over
the sorted face lines, and those lines are text at six decimals, so a
one-ULP difference anywhere flips a digit and the digest with it — measured,
that is enough to move the digest at 8 of `windmill/turning`'s 27 sample
points on a perturbation far smaller than two runtimes' trig will produce.
Use it to tell whether two runs of the SAME implementation agree. Compare two
implementations with `--mesh-faces` and a per-number tolerance.

**Sort the face lines with `StringComparer.Ordinal`.** `--mesh` sorts them,
and .NET's default string comparer is culture-sensitive — see hazard S6. The
digest, if a port reproduces it, is 32-bit FNV-1a (offset basis `0x811c9dc5`,
prime `0x01000193`, `Math.imul` semantics, i.e. wrapping 32-bit multiply)
over each line's UTF-16 code units with `\n` folded in after every line
including the last.

**Sample times are part of the criterion**, because detection is
sampling-dependent: a wrong `outBounce` threshold shows at 241 samples per
clip and not at 9. For each clip of each model, sample

```
t = k·duration/24   for k = -1 … 25
```

— which covers the clip, both ends of the §6.7 wrap interval, and one step
outside it in each direction, where a looping clip must wrap and a
non-looping one must hold.

This is what the criterion always meant and did not previously say. Each
clause above is there because a deliberately-wrong implementation passed
everything else. Measured:

| wrong implementation | caught by |
|---|---|
| drop `pivot.rot`; swap `q_pivot ⊗ q_rotation`; Euler XYZ; drop manifest `rotation` | `--transforms` |
| never implement `socket-frame.ts`; ignore a socket's own `rot` or the pivot offset | `--sockets` |
| never implement `stepVisible`, or `visible` at all | `--transforms` `visible=` |
| scale in world axes after the rotation instead of about the pivot before it; ignore `scale` | `--transforms` `scale=`, and `--sockets` |
| no §6.5 carryover — an omitted keyframe field taking the default instead of the previous value | `--transforms` |
| no face culling; a translucent neighbour hiding a face; reversed winding; a flipped normal | `--mesh` |
| the material list in walk order instead of §7.4's; a `Comparison<T>` that truncates the difference to an int | `--mesh` `materials=` |
| `opaqueIndexCount` covering the translucent groups too | `--mesh` `opaque-faces=` |

Before the pose fields and the mesh query, every row below the first two was
undetectable: they produced byte-identical output for every model, every clip
and every sample time.

One §7.4 rule stays outside this contract, and it is worth being exact about
why. An index no palette defines renders as opaque magenta (§7.4). No *valid*
model can exercise it, so no fixture and no `cuboidy-query` output reaches it;
it is pinned by `mesh.test.ts` and a port should pin it the same way.

But do not read that as "unreachable". The check that refuses such a model
lives in `cli/assemble.ts` and `lint/cross-file.ts`, **both dropped** — so in
the C# library the magenta path is live, not defensive. It is what a caller
gets for handing `BuildMesh` a part whose palette is short, which is exactly
what a runtime with no lint will do.

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

### Two audits happened before this

Both were read-only sweeps over `ts/packages/core/`, both produced work that
has since landed, and neither file survives — the findings are in this
document, in `SPEC.md` and in the tests, which is where a porter will look.
`git log` has the rest.

The first (2026-08-08) settled ten open questions where SPEC and the
implementation disagreed or SPEC was silent, and produced the diagnostic
unification, the reference fixes, and `--transforms` / `--sockets` / `--anim`.

The second (2026-08-09) asked one question of the result: *would the
acceptance contract catch a wrong port?* It found four classes that would
not — no `visible`, no §6.5 carryover, no `mesh.ts` at all, and `scale`
hanging off one socket on one model — plus three §6.7 rules the reference did
not actually keep, and the type collisions above. What that says about
process is worth keeping: the first audit's own work was where the second
audit found the most, because a fix and its check tend to be written by
whoever already believes the fix is right.

So the standing advice for the port is the same one those two rounds
produced. **Do not ask whether the C# side passes; ask what it could get
wrong and still pass.** Break the implementation on purpose, run the whole
contract, and count the differing lines. Every row of the table in "Done
means" was measured that way, and every one of them was zero once.
