# Core port-readiness audit

Settled 2026-08-08, before any C# code exists. Four independent read-only
audits over `ts/packages/core/`, each with a different lens — the port-scope
sources, duplication, module boundaries, and the acceptance contract — then
cross-checked against each other, against `SPEC.md`, and against
`docs/working/refactor-backlog.md`.

Every number below was measured against the source at that date, not inferred.
Line numbers will drift; treat them as pointers.

The question this answers is narrower than "is core clean". It is: **where
would the C# port encode something wrong, lose a rule, or be unable to tell
that it had?** Cleanliness that does not affect that question is left to
`docs/working/refactor-backlog.md`.

This file lives under `docs/working/` because most of it is consumed rather
than kept: the audit is a snapshot that decays as the code moves, and the work
order shrinks to nothing. The decisions are the exception — five were taken
before the work started and five more fell out of doing it; see "Where the
decisions land" for where each one goes before this file is deleted.

## Verdict

The structure is sound. The damage is concentrated in the diagnostic layer and
in the acceptance contract, and both are cheaper to repair in TypeScript than
to discover twice.

What is already right, and should not be disturbed:

- **The cut line exists in the code.** Zero imports run from the port scope
  into `render/`, `cli/`, `lint/`, `geometry/serialize.ts`, or
  `animation-edit.ts` — including type-only imports. The 60 edges that cross
  do so in the allowed direction. The port's stated scope boundary is
  achievable as written.
- **No circular imports** anywhere in `core/src` (51 files, DFS).
- **The port scope is pure.** `node:fs` / `node:path` / `process` appear only
  under `cli/`. No DOM types. The only external dependency in the closure is
  `zod`, which the port replaces. `project.ts` takes IO by injection twice
  over — `files: ReadonlyMap<string, string>` and a `readPalette` callback —
  so a C# loader can reuse the decomposition verbatim.
- **The rig math is the best-documented code in the package.**
  `rig-transform.ts:10-13, 21-24, 71-79, 110-113` state the convention (Euler
  degrees, ZXY intrinsic, right-handed, quaternions as `[x,y,z,w]`), the
  closed form, and `q_local = q_rotation ⊗ q_pivot ⊗ q_anim`, all matching
  SPEC §4 and §7.7 verbatim and verified numerically.
- **The generated schemas are in sync.** Both `schema/*.schema.json` byte-match
  a fresh regeneration from the Zod sources. `json-schema.ts:23-61` correctly
  re-injects what Zod drops. This is the healthiest single-source relationship
  in the package.
- **The suite is green**: 797 tests across 42 files in ~10s, `typecheck` clean
  in all four packages.

## Decisions taken

D1–D5 were open questions where SPEC and the implementation disagreed, or
where SPEC was silent. D6–D10 came up while doing the work. All are settled
here so the port has one answer to translate rather than two to reconcile.

### D1 — SPEC is the authority for diagnostic codes

`docs/csharp-implementation.md` says "where the two disagree and the spec is
silent, TypeScript is right and the spec gets the amendment". For the
diagnostic codes SPEC is *not* silent, and TypeScript is the one out of line.
`manifest.ts` is corrected to match SPEC §11.2; `geometry/parse.ts` already
does.

The decision is not close, because the current manifest behaviour is an
accident rather than a design: `parseManifest({name:'m', parts:[{}]})` returns
`code: 'invalid-value'` together with the message
`'parts.0.name: required field is missing'`. `manifest.ts:221` computes the
message off one predicate and `manifest.ts:266-272` computes the code off
another, and only the message says what SPEC requires.

### D2 — Animation time keys require a decimal point

The grammar becomes `^[0-9]+\.[0-9]+$`, stated in SPEC §6.6. (No sign: a time key is a position in a clip, and the first must be `"0.0"` anyway.) `"1"` is not a legal
time key; `"1.0"` is.

This closes two divergences with one rule. First, JavaScript hoists
canonical-integer keys to the front of an object, so
`JSON.parse('{"0.0":1,"0.5":2,"1":3}')` yields keys in the order
`["1","0.0","0.5"]` and `animation.ts:83` rejects a spec-legal document with
`first time key must be "0.0" (got "1")` — while `System.Text.Json` reads
document order and would accept it. Second, `Number(key)` currently accepts
`"0x10"` → 16, `"0b11"` → 3, `"0o17"` → 15, `"1e3"` → 1000, `"5."`, `"+1"`,
where `double.Parse(…, NumberStyles.Float, InvariantCulture)` rejects all of
them.

All seven shipped models already write the decimal form, and SPEC §6.6 already
exemplifies `"1.25"`, so the format's own convention was never in doubt.

### D3 — Animated `scale` moves a socket, but does not resize the guest

`socket-frame.ts` applies `(socket.pos − pivot.pos) × scale + pivot.pos`
before the pivot rotation — the same expression SPEC §7.7 already applies to
voxels. `SocketFrame` stays `{pos, quat}`, so an attached model moves to the
right place at its own size.

SPEC §7.8 was silent. The alternative — sockets ignoring scale, which is what
`socket-frame.ts:60-80` does today — leaves the socket of a 3×-scaled arm
buried a third of the way along it. Carrying scale through to the guest was
rejected because it would deform a held sword when the wielder's torso does a
squash-and-stretch breath.

### D4 — Core owns the application of `scale` and `visible`

Core gains a function returning a part's local vertex transform (pivot-relative
scale included), and the existing call sites move onto it. The C# side ports
it, so a Godot addon calls rather than reimplements.

**Corrected after review.** The rule was written TWICE outside core, not three
times — `cli/gif-runner.ts` only plumbed `scale` through to the rasterizer.
Of the two, `render/scene.ts` moved onto `localPointToWorld`;
`ui/src/scene/RiggedParts.tsx` still expresses it as nested three.js groups,
verified equivalent but still a second statement. It could not have moved at
first, because the function was not exported from the barrel — fixed since.

Today `animation.ts:146-151` produces the two fields, `rig-transform.ts:100-104`
explicitly refuses to consume them (scale is local and does not propagate to
children, so it cannot join `WorldTransform`), and the rule is written three
times, all outside the port scope: `render/scene.ts:85-93`,
`cli/gif-runner.ts:141-148`, `ui/src/scene/RiggedParts.tsx:186-196`.

D3 forces this one. Once `socket-frame.ts` interprets scale, a core that
interprets it for sockets but not for geometry has no defensible line.

### D5 — A duplicate part name is a resolution failure, not a lint finding

`resolveProject` reports `duplicate` and sets `complete: false`.

`project.ts:238-246` currently lets the first listed file win, silently:
two files defining `x` resolve with `complete: true` and no diagnostic, while
SPEC §11.6 calls it an error and only `lint/` — out of port scope — says so.
So the C# library would load a model the TypeScript lint rejects.

The deciding factor is not conformance but determinism. *Which* file wins is
decided by the iteration order of `project.ts:95`'s `Set`, and C#'s `HashSet`
and `Dictionary` guarantee no order at all. Left alone, two implementations
could pick different winners for the same model. Rejecting the ambiguity
removes the question. (Ordering still has to be specified for
`geometryPaths` — see H6 — so this does not avoid that work, it only removes
the worst consequence of getting it wrong.)

### D6 — An array bound reported against a container is `wrong-arity`

Taken during P1, where the unified mapping needed one rule for every array
bound rather than the per-field special cases the three readers each carried.

§11.2 settles most of it directly: an empty `parts` is `missing` ("no `parts`,
or `parts` present but empty"), an inline palette with 0 or more than 62
colors is `wrong-arity`, and a `size` dimension outside `[1..1024]` is
`invalid-value`. The rule that produces all three is *what the bound was
reported against* — a container means the wrong number of items, an element
(the last path segment is an index) means that element's value is out of
range — with `parts` as the single spec-named exception.

**Corrected after review.** This section originally claimed the one case SPEC
does not name is an empty manifest `geometry` list, and mapped it to
`wrong-arity` for consistency. SPEC names it: §11.5 files "duplicate or empty
`geometry` list" under `invalid-value`, in a section this work never opened,
which D1 makes authoritative — and the old reader had it right by falling
through. The change was a regression and is reverted; `geometry` is now the
named exception to the container rule, which is what the spec asks for. Two
arrays spelled the same way, coded differently, and the spec is explicit
about both.

### D7 — Easing endpoints are clamped, not trusted

Taken during P2. SPEC §6.7 and `easing.ts` both asserted that every preset
maps 0 → 0 and 1 → 1 "so keyed values are always hit exactly at their
keyframes". Five of the twenty do not: `in-sine(1)` is 0.9999999999999999,
`in-back(1)` is 0.9999999999999998, `out-back(0)` is 2.220446049250313e-16,
and `in-out-sine(0)` is `-0`.

`applyEasing` returns 0 and 1 for those inputs rather than evaluating the
formula. (Five presets miss: `in-sine(1)`, `in-back(1)`, `out-back(0)`, and
`in-out-sine(0)` and `in-out-back(0)`, which both return `-0`. An earlier
draft of this section and of §6.7 said one preset returned `-0`.) The endpoints are where an author placed a value and expects to see
it, and they are where a second implementation's trig is most likely to round
the other way — so making the guarantee true is worth more than preserving
five rounding residues. Interior values are deliberately left alone: they are
what the formulas produce, and a port must evaluate the same expressions
rather than algebraically equivalent ones.

### D8 — An index no palette defines renders as opaque magenta

Taken during P3. The fallback existed — `mesh.ts` returns `[1, 0, 1]` — but
only as a comment, in a file the port takes, while every layer that *reports*
the problem is a layer the port drops. A C# reader working from the spec
alone would index its palette with an out-of-range value and throw, on input
the reference implementation draws.

So §7.4 states it. A runtime that only draws needs a defined answer, and a
conspicuous color is a better one than a crash, a skipped voxel, or an
out-of-bounds read. Reporting stays an authoring-time concern (§11.6).

### D9 — `render/camera.ts` is not ported

Taken during P4. It reads like a candidate for an exception: pure math,
depending on nothing but `render/vec.ts`, barrel-exported with a comment
explaining that it pulls no CLI or Node code into a bundle, and consumed by
the workspace's thumbnail view. But its `Angle` set is the contact-sheet
convention `cuboidy-snap` renders — not a format rule — and an engine that
draws the mesh already has a camera. Dropped with the rest of `render/`,
now by decision rather than by category.

### D10 — A resolver's diagnostic has no lint rule ID

Also P4. `ProjectDiagnostic` carried a `Diagnostic`, whose `ruleId` is one of
eleven `W`/`H` identifiers from §11.3/§11.4 — and `project.ts` never set it,
at any of its eight sites, because resolution has no such vocabulary. The
port would have carried the enum into a library that has no lint.

`ResolutionDiagnostic` is `Diagnostic` without `ruleId`. Structurally still a
`Diagnostic`, so every consumer renders these unchanged; the line the port
plan draws in prose is now drawn in the types.

### Where the decisions land

Only these five outlive this file, so each has a home to move to. The move
happens when the corresponding chunk lands, not before — `SPEC.md` should
describe what the code does, not what it is about to do. Until then the
decision is settled here and unimplemented there.

| decision | destination | with |
|---|---|---|
| D2 time-key grammar | `SPEC.md` §6.6 | P2 ✔ |
| D5 duplicate is a resolution failure | `SPEC.md` §11.6 | P2 ✔ |
| D7 easing endpoints are clamped | `SPEC.md` §6.7 | P2 ✔ |
| D3 socket scale | `SPEC.md` §7.8 | P3 ✔ |
| D4 core owns `scale`/`visible` | `SPEC.md` §7.7, and the scope table in `docs/csharp-implementation.md` | P3 ✔ |
| D8 an unresolved index renders magenta | `SPEC.md` §7.4 | P3 ✔ |
| D9 `render/camera.ts` is not ported | `docs/csharp-implementation.md` | P4 ✔ |
| D10 resolvers carry no lint rule ID | `docs/csharp-implementation.md` | P4 ✔ |
| D1 SPEC is the authority for diagnostic codes | `docs/csharp-implementation.md` — it amends that document's own "TypeScript is right" rule | P1 ✔ |
| D6 array bounds against a container | `docs/csharp-implementation.md`, via the pointer at `zod-diagnostic.ts` | P1 ✔ |

Once P4 is done, everything left here is history, and the file goes the way
`docs/ux-backlog.md` did: deleted, recoverable from git, with a pointer in
`README.md` if anything still refers to it.

## Findings

### 1. The diagnostic layer disagrees with itself

Three readers map Zod failures to `CuboidyErrorCode` independently —
`manifest.ts:256-290`, `geometry/parse.ts:196-230`, `palette-file.ts:31-38`.
`docs/working/refactor-backlog.md` logs this as R3-c and describes it as a
disagreement about `missing`. Measured, it is four classes wide, and SPEC
sides with `geometry/parse.ts` every time:

| mistake | `parseGeometry` | `parseManifest` | SPEC §11.2/§11.8 |
|---|---|---|---|
| part missing `name` | `missing` | `invalid-value` | `missing` |
| inline palette empty | `wrong-arity` | `invalid-value` | `wrong-arity` |
| inline palette over 62 | `wrong-arity` | `invalid-value` | `wrong-arity` |
| coordinate not a triple | `wrong-arity` | `invalid-value` | `wrong-arity` |

Root cause: `manifest.ts:264-272` gates `missing` on
`path.length === 1 && (path[0] === 'name' || 'parts')`, so nothing nested can
ever be `missing`, and it has no arity ladder at all.

Three further defects in the same layer:

- **`manifest.ts` never unwraps a Zod union.** `geometry/parse.ts:24` calls
  `unwrapUnion` (`parse.ts:172-183`) to dig the real diagnosis out; the
  manifest takes `issues[0]` raw. It has three union sites — `palette`
  (`manifest.ts:126`), part `geometry.palette` (`manifest.ts:37`), and
  `animations` values (`animation.ts:126`). The whole §6.7 keyframe surface
  collapses into `invalid-value · animations.w: Invalid input`, where SPEC
  wants `unknown` for an unrecognised keyframe field or ease name, and
  `missing` for an absent `loop`. The same clip in an external file goes
  through `InlineAnimationSchema` directly (`project.ts:389`) and produces a
  precise message with the code hardcoded to `invalid-value`
  (`project.ts:395`) — so a bad clip reports differently depending on where it
  is written.
- **Inline geometry violates SPEC §11.8 phase precedence.**
  `GeometrySchema.superRefine` (`schema.ts:177`) runs after the document's
  phase-2 parse and is conforming. `PartGeometrySchema.superRefine`
  (`manifest.ts:43`) runs inside the field parse, so a phase-3 row-width error
  on part 0 is reported instead of a phase-2 missing `name` on part 1. SPEC
  calls reporting a later phase over an earlier one non-conforming, and a C#
  port implementing the phase loop literally produces the other answer.
- **`palette-file.ts:39` calls `err(code, message)` with no `path`**, so no
  palette-file error can be located to a line by `locateJsonPath`, though
  `result.ts:6-12` documents `path` as present for structured formats. It is
  also the only reader that emits raw Zod prose
  (`"colors: Invalid input: expected array, received undefined"`) where the
  other two substitute `"required field is missing"`.

Diagnostics are also derived from Zod internals a hand-written validator
cannot mirror. `parse.ts:225-228` decides bad-element vs bad-length by whether
the last path segment is numeric — a heuristic over Zod's issue path, not a
stated rule. `isMissingAtPath` exists verbatim twice (`manifest.ts:238-254`,
`parse.ts:232-245`) purely because Zod 4 drops the `received` field; a C#
validator knows directly whether a key was present, and the mechanism — along
with the guarantee that it lands on the same branch — disappears.

### 2. Runtime rules that live only outside the port scope

Each of these is a rule the C# side needs and would not receive.

**Palette index range (§7.4).** `geometry/schema.ts:134-136` and
`manifest.ts:73` defer the check when the palette length is not knowable at
parse time, nominally to §11.6 cross-file validation. Measured across the four
ways a palette can reach a part:

| how the palette arrives | parse | `resolveProject` | lint | `cli/assemble.ts` |
|---|---|---|---|---|
| inline part, inline palette | catches | — | — | — |
| geometry file with `palette: "p.json"` | defers | silent | catches | catches |
| inline part on the manifest palette | defers | silent | **nothing** | **only here** |
| inline part with its own palette ref | defers | silent | **nothing** | **only here** |

Rows 3 and 4 are a hole in lint as well, not only a port gap:
`lint/cross-file.ts:182-191` short-circuits on `r.palette.length > 0`, so a
resolved-but-too-short palette is never compared against `maxPaletteIndex`.
Verified end to end — an inline part using index `5` against a two-colour
manifest palette parses, resolves and lints clean, and `buildMesh` returns
magenta. `project.ts`, the plan's designated resolver, does no range checking
at all.

**Effective palette merge.** `cli/assemble.ts:209-285` is the only answer to
"N geometry files with N palettes, what are the indices in one draw call" —
first palette-bearing part maps identically, later ones dedupe by exact RGBA,
overflow past 62 warns. Alongside it, `assemble.ts:227-237` is the only place
"indices with no resolved palette" is a hard error, where
`lint/cross-file.ts:158-166` emits `missing` and `mesh.ts:65` draws magenta.
Three policies for one condition. A C# renderer can sidestep the merge by
keeping `ResolvedPart.palette` per part — but nothing in scope says so, and
`buildMesh(part, palette)` invites the other reading.

**`scale` and `visible` application** — resolved by D4.

**Duplicate part names** — resolved by D5.

### 3. Defects in the reference implementation

Independent of the port, these are wrong today.

- **Time-key ordering** (D2). The reference rejects spec-legal documents.
- **Two formulas for the §6.7 wrap, in one file.** `animation.ts:243`
  (`time % duration`, then `+ duration` if negative) versus `animation.ts:269`
  (`time - Math.floor(time / duration) * duration`). Measured:

  ```
  t=5   dur=0.1  clampToClip 0.09999999999999973  samplePart 0
  t=0.7 dur=0.1  clampToClip 0.09999999999999992  samplePart 0.09999999999999987
  t=10  dur=0.3  clampToClip 0.10000000000000037 samplePart 0.09999999999999964
  ```

  The scrubber calls the exported `clampToClip`; the sampler uses the inline
  form. In the first row they are a full clip apart — the UI reports the end of
  the loop while the model is posed at the start. `clampToClip` has no test
  anywhere in core.
- **`easing.ts:112-114` and SPEC §6.7 both assert something false.** They claim
  every preset maps 0 → 0 and 1 → 1 exactly. Measured: `in-sine(1)` =
  0.9999999999999999, `in-back(1)` = 0.9999999999999998, `out-back(0)` =
  2.220446049250313e-16. This matters more than a comment normally would: the
  port's numeric parity requires the *same expression in the same order*, and
  the comment tells a porter that any algebraically equivalent formula will do.
- **`stepVisible` alone uses an undocumented epsilon.**
  `animation.ts:221-229` compares `k.t <= t + 1e-9`; segment selection for
  `rot`/`pos`/`scale` (`animation.ts:278-306`) is exact. At `t = 0.999999999`
  against a key at `1.0`, `visible` has flipped while `rot` is still
  interpolating at ≈89.99999991°. The epsilon is absolute, so it is
  meaningless at large `t`.
- **`resolveProject.complete` does not mean what its comment says.**
  `project.ts:161-165` promises "every referenced file loaded and parsed and
  reuse fully resolved"; `project.ts:427` sets `diagnostics.length === 0` and
  never consults `unresolved`. A manifest with a part defined in no geometry
  file resolves `complete: true`.
- **`computeWorldTransforms` mishandles malformed hierarchies in ways
  `forest.ts` does not.** Both claim renderer-grade leniency
  (`rig-transform.ts:114-118`, `forest.ts:1-7`). Measured on the same inputs: a
  self-parented part at `position [1,0,0]` lands at `[2,0,0]` — its own
  transform applied twice — where `buildForest` treats it as a root; an unknown
  parent name is cached as an identity transform and appears as a **phantom key
  in the returned map** (`rig-transform.ts:143-145`), a part the model does not
  have; a 2-cycle produces asymmetric, iteration-order-dependent positions.
  `rig-transform.ts` is the copy that gets ported, and it will be the only
  hierarchy walk on that side, with nothing to compare against. [R3-e]

### 4. C#-specific hazards

Measured on the JavaScript side; the .NET half is from documented semantics.

| # | hazard | consequence |
|---|---|---|
| H1 | `size.w / 2` (`parse.ts:129`, the §7.7 default pivot) | `z.number().int()` invites `int` in C#, where `W / 2` is integer division: a width-3 part gets pivot `1` instead of `1.5` and every downstream coordinate is off by half a voxel, with no error. `mesh.ts:54`'s `c.r / 255` is the same shape. |
| H2 | `$` in .NET regex also matches before a trailing `\n` | `"name": "head\n"` is rejected by TS and accepted by .NET. Four sites: `identifier.ts:24`, `schema.ts:24`, `schema.ts:39`, `ref-path.ts:13`. Use `\z`. |
| H3 | `round6` is `Math.round` — half toward `+∞` | C# `Math.Round` is banker's; `AwayFromZero` differs on negatives. The correct C# is `Math.Floor(n * 1e6 + 0.5) / 1e6`. |
| H4 | `round6` can return `-0` | JS `String(-0)` is `"0"`, .NET `(-0.0).ToString()` is `"-0"`. Corrupts both printed output and the grid key at `assemble.ts:416`. Normalise with `+ 0.0` before formatting. |
| H5 | `normalizeRefPath` (`project.ts:474-485`) is not `Path.GetFullPath` | `"a//b.json"` → `"a/b.json"`, `"/abs.json"` → `"abs.json"`, `"a/../../b.json"` → `"../b.json"`, `"a\\b.json"` keeps the backslash, `"a/.."` → `""`. Windows `Path` APIs differ on every one. Port by hand. |
| H6 | `Dictionary`/`HashSet` are unordered where JS `Map`/`Set` preserve insertion | `project.ts:95` decides the geometry list order and `assemble.ts:223` decides merged palette indices — hence every character `cuboidy-query` prints. Specify ordered collections. |
| H7 | `.sort((a,b) => a.t - b.t)` is stable in JS since ES2019 | `List<T>.Sort` is introsort and unstable. Use `OrderBy`. Reachable only for tracks that bypassed validation, which `samplePart` documents itself as tolerating. |
| H8 | Structural typing has no C# counterpart | `Pose` → `AnimPose` (`socket-frame.ts:94`, `rig-transform.ts:127`) and `PartExtent` (`rig-transform.ts:191-199`, callers pass real `Part`s) are free in TS and need an interface or projection in C#. |
| H9 | `mesh.ts:41-45,59` index voxels unchecked | TS reads `undefined`, compares it against `AIR`, treats it as solid and paints magenta; a 2-wide part with a 1-wide row produced 40 vertices instead of 24 with no error. C# throws. Reachable through `resolveProject`'s `overrides`, and `buildMesh` is public with no arity precondition stated. |
| H10 | `z.number().int()` accepts JSON `3.0` | A C# reader calling `GetInt32()` throws where one calling `GetDouble()` and testing `% 1 == 0` matches. Same class for `duration` and every coordinate. |
| H11 | SPEC §9 forbids a BOM; nothing enforces it | It falls out of `JSON.parse` throwing on `﻿`. C#'s readers are more permissive depending on entry point, so this needs to be explicit. |

`easing.ts:54-56` (`n1 * (u -= 1.5/d1) * u + 0.75`) reads like a landmine and is
not one — C# evaluates it identically. Do not tidy it during the port; the
residue is observable.

### 5. The acceptance contract cannot catch a wrong port

`docs/csharp-implementation.md` defines "done" as the fixtures corpus, the
seven models loading clean, and numeric parity through `cuboidy-query`. As it
stands, a C# port can ignore `pivot.rot` entirely, compose
`q_pivot ⊗ q_rotation` in the wrong order, and never implement
`socket-frame.ts`, `mesh.ts`, `easing.ts` or `animation.ts` at all — and pass
every fixture and every model.

**`cuboidy-query` has no animation.** `cuboidy-query.ts:47-73` accepts only
`--at` and `--core`; `assemble.ts:319` calls `computeRestWorldTransforms`;
`query-runner.ts` contains no reference to time. The criterion describes a
check the shipped tooling cannot perform, so `animation.ts` and all twenty
easing curves sit outside the contract entirely.

**Rotation is nearly invisible even in rest pose,** because
`assemble.ts:357-359` places voxels axis-aligned and
`gridRotationWarnings` says so out loud. A part's orientation shows up only
through the pivot translation of its descendants. Recomputing every model's rig
with deliberately wrong math and diffing `round6`'d positions:

| wrong implementation | fox | herbalist | knight | koi | owl | sword | windmill |
|---|---|---|---|---|---|---|---|
| ignore `pivot.rot` entirely | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| swap to `q_pivot ⊗ q_rotation` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Euler XYZ instead of ZXY | 0 | 3 | 2 | 0 | 4 | 0 | 0 |
| ignore manifest `rotation` | 9 | 6 | 4 | 0 | 4 | 0 | 0 |

(parts whose world position changes). Only windmill uses `pivot.rot` and its
five bearers are childless leaves, so §7.7's composition order is unobservable
across the whole gallery. Euler order is caught by three models and by a
fourth-decimal difference — knight's `hand-r` moves 5.731821 → 5.731059.

**The numbers it does print come from dropped code.** The only numeric output
is six bbox values and two core-range endpoints, all passed through `round6`
from `num.ts` — a file in neither the port list nor the drop list — inside
`cli/assemble.ts`, which is dropped.

**The corpus is thin where it matters most.** Nineteen JSON fixtures, not the
twenty the plan states. `fixtures/manifest/` is two files covering one code, so
the entire §11.5 table is unfixtured — which is also why §1's divergences went
unnoticed, since those two files are exactly the two cases `manifest.ts`
special-cases by hand. `palette-file.ts` is in the port scope with no fixtures
at all. §6.13 inline part geometry — the majority of `project.ts` — has no
fixture and is used by none of the seven models, nor is the manifest-level
palette. §8 relative reference resolution never fires, because every geometry
file in every model sits at the package root. All 78 colours are `#RRGGBB`, so
`#RGB`, `#RGBA`, `#RRGGBBAA` and the alpha channel are untouched. Seven of the
twenty easing presets appear in no model.

**Adding a fixture kind would be silently ignored.**
`fixtures-parity.test.ts:22-25` hardcodes `[['geometry', parseGeometry],
['manifest', parseManifest]]`.

**Two port-scope modules are barely unit-tested for semantics.** `mesh.ts`'s
tests assert counts, culling and index type, and never a vertex position,
corner order, winding, face order or normal — though `mesh.ts:9-10` claims all
four "ARE the reference for parity". `easing.ts` pins endpoints for all twenty
presets but interior values for four, so a wrong `C1`–`C5` or a wrong
`outBounce` threshold passes.

### 6. Naming the port must resolve

The plan says "keep the same names wherever C# allows". These are where it
does not, or where keeping them freezes an ambiguity.

- `Vec3` is declared four times — `geometry/types.ts:9` (`{x,y,z}`, public),
  `render/vec.ts:7` (a tuple, public), plus identical Zod consts at
  `manifest.ts:12` and `geometry/schema.ts:28`. `Vec3Tuple` is declared three
  times, including a value and a type **in the same file**
  (`animation.ts:24` and `:142`) which C# cannot express, and readonly at
  `rig-transform.ts:15` versus mutable at `animation.ts:142` — a distinction
  that dissolves in C#, so the port makes the decision whether or not anyone
  takes it. [R3-g]
- The §7.4 alphabet is mapped twice, both in the port scope, under different
  names and with different behaviour: `voxel-row.ts:19-26` `charToIndex`
  returns `AIR` for `'.'`, `schema.ts:204-209` `charIndex` returns `-2`, safe
  only because `schema.ts:138` filters `'.'` first. That guard is load-bearing
  and nothing says so.
- `WorldTransform` (`rig-transform.ts:95`) and `SocketFrame`
  (`socket-frame.ts:23`) are structurally identical `{pos, quat}`. In C# they
  are two records that are not assignable to each other unless someone decides
  they are the same type.
- `RESERVED_KEYWORD_SET` is built twice from the same source
  (`identifier.ts:22`, `identifier-schema.ts:15`), in two port-closure files
  that already import from each other.
- `Size` and `Socket` each collide as Zod const versus interface today and are
  reborn as DTO versus AST in C#, where `System.Text.Json` will not hide it.

### 7. What the plan's scope table omits

The table names ten modules; the real port closure is nineteen files. Nine
required files are unnamed — `result.ts`, `diagnostic.ts`, `identifier.ts`,
`identifier-schema.ts`, `ref-path.ts`, `geometry/types.ts`,
`geometry/palette.ts`, `geometry/voxel-row.ts`, `geometry/locate.ts` — with
`geometry/types.ts`, the AST every ported module produces or consumes, the
conspicuous one. Five more are classified as neither ported nor dropped:
`forest.ts`, `geometry/transform.ts`, `index.ts`, `json-schema.ts`, `num.ts`.
Of those, `forest.ts` has zero consumers inside `core/src` and should not be
ported; `num.ts` matters only if the parity harness reimplements `round6`
(H3).

Two smaller boundary questions the table decides by category rather than by
argument:

- `render/camera.ts` is pure math depending only on `render/vec.ts`, is
  barrel-exported with a written justification at `index.ts:117-123`, and is
  consumed by `workspace/src/lib/thumbnail.ts`. Dropping all of `render/`
  takes it too, so a C# consumer wanting the same named viewpoints has nothing.
- `diagnostic.ts` drags the lint vocabulary into the runtime: `project.ts:1`
  imports `Diagnostic`, whose fields are a three-value `Severity` and an
  eleven-value `LintRuleId` (W01–W08, H01–H03). `project.ts` emits `'error'` at
  all eight sites and never sets `ruleId`. The plan's "resolution is in scope,
  reporting is not" is right in intent and not drawn in the types.

## Work order

Four chunks, in order. Each is committable and verifiable on its own. The
first two are what make the port's translation source trustworthy; the third
is what lets anyone tell whether the translation succeeded; the fourth is
cosmetic by comparison and can wait until the C# side is being written.

**P1 — one diagnostic mapping, SPEC-conformant, pinned by fixtures.** *Done —
`7bae427`, `c3990dc`, `f127994`. D1 and D6 have landed in
`docs/csharp-implementation.md`; the corpus is 38 files across three kinds.*
Collapse the three Zod→code ladders into `zod-diagnostic.ts` with
`resultFromZodError(error, input, opts)` [R3-c], correcting `manifest.ts` to
SPEC per D1, adding union unwrapping to the manifest's three union sites, and
giving `parsePaletteFile` a `path`. Move `PartGeometrySchema.superRefine` out
of the field parse so §11.8 precedence holds. Then add
`fixtures/manifest/{duplicate,unknown,invalid-value,wrong-arity}/` and a
`fixtures/palette/` kind, and make `fixtures-parity.test.ts` discover kinds
rather than hardcode two. *This chunk's output is what the C# side is
validated against, which is why it is first.* Behavioural: snapshot the
before/after codes across the corpus.

**P2 — fix the reference implementation.** *Done — `212e8dc`, `3443d6b`,
`7c00958`, `b2d36ac`, `1e10f85`. D2, D5 and D7 have landed in `SPEC.md`.* D2's time-key grammar; one wrap
formula; `complete` honouring `unresolved` (D5 lands here too, since both
touch the same return); the `easing.ts:112-114` comment and the matching SPEC
§6.7 sentence corrected; `stepVisible`'s epsilon either documented in SPEC or
removed; one `partHierarchy(parts)` replacing the divergent walks so
`rig-transform.ts` stops double-applying self-parents and emitting phantom map
keys [R3-e].

**P3 — rules and contract.** *Done — `3b0e122`, `b59f8ac`, `1a80292`,
`5845957`. D3, D4 and D8 have landed in `SPEC.md`; "Done means" is rewritten
around `--transforms` / `--sockets` / `--anim`.* Palette index range enforcement moved into
`project.ts`; D3's socket scale; D4's local-transform function with the three
call sites moved onto it. Then `cuboidy-query` gains `--anim`/`--time` and a
`--sockets` mode printing socket frames as numbers, and either a
rotation-aware grid or per-part world transform output. Finally one model
exercising §6.13 inline geometry, a manifest-level palette, a geometry file in
a subdirectory, **a `pivot.rot` on a part that has children**, and the unused
easing presets — promoting `ts/testdata/inline` is a candidate. Compare parsed
doubles with a tolerance, never printed strings.

**P4 — naming and packaging, before the first C# commit.** *Done —
`3044524`, `9e9f457`, `4718b9d`, plus the `Frame` unification. D9 and D10
below.* §6's collisions;
the scope table in `docs/csharp-implementation.md` corrected to nineteen files
with the five unclassified ones decided; explicit decisions on
`render/camera.ts` and on splitting the lint vocabulary out of `Diagnostic`;
R3-k, shipped as a `prepare` script rather than the `development`
conditional export the backlog proposed — it also has to work for `tsc -b`
and vitest, which do not resolve that condition; core's `tsconfig.json` widened so
`test/` and `scripts/` are type-checked at all.

## Deferred

`docs/working/refactor-backlog.md` R3's remaining chunks — the barrel trim, the CLI
shell dedup, the shared face table, the ui rig API flip, the shared tree
components, the scene-domain question — are unaffected by the port and stay
where they are. The module boundaries are already good enough for a second
implementation; nothing in R3-a, R3-b, R3-d, R3-f, R3-h, R3-i or R3-j needs to
happen first.
