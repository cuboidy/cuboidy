# Is SPEC 0.9 ready to be 1.0?

Written 2026-09-22, against `SPEC.md` at `4e491ed`, after `@cuboidy/core` and
`@cuboidy/three` were packaged for npm at 0.9.0.

Two questions were asked: should the spec go to 1.0, and how finished are the
packages. They have different answers, so they are kept apart here. The short
form is at the end of each half.

The evidence used throughout: `npm test --workspaces` (1164 passing), `dotnet
test` in `csharp/` (409 passing), a regeneration of the parity artifacts that
came back byte-identical, the shared `fixtures/` corpus, the nine models under
`models/`, a field census of the 97 packages Tropalm ships against this format,
and `git log` over `SPEC.md` since the commit that set the version to 0.9.

---

## 1. What "0.9" currently means

`SPEC.md:3-4` says:

```
**Version:** 0.9 (draft)
**Status:** Early draft. Subject to change before v1.0.
```

That string was written on 2026-07-16 by `cccdd2d`. Since then 244 commits
have landed, 37 of them touching `SPEC.md`, and the version string has not
moved. Among those 37 are eight additions to the format itself:

| Landed | Commit | What the format gained |
|---|---|---|
| 2026-07-31 | `fd0ff25` | The palette moved from the manifest to the geometry file (§6.1, §7.1, §7.4) |
| 2026-08-01 | `626d83a` | `sockets` on the manifest — published sockets (§6.12) |
| 2026-08-01 | `439d0eb` | A part may carry its geometry, by reference or inline (§6.13) |
| 2026-08-01 | `1fe3e9d` | The packed `.cuboidy` container (§13) |
| 2026-08-08 | `004b2bc`, `228c68e` | A palette entry may be a material object, and may be translucent (§7.4) |
| 2026-08-25 | `37de2e7` | The voxel alphabet gains `$` and `%`, so 64 colours fit in one file (§7.10, §7.4) |
| 2026-08-26 | `4b22297` | A part gets a rest `scale` (§6.2) |
| 2026-09-12 | `db730d1` | `openBoundaries`, and the bake that omits the faces on them (§6.14, H05) |

Every one of those is a document written before it that a reader would now
accept, and a document written after it that the same reader would reject —
and all of them are `"version": "0.9"`.

This is the finding that decides the question. The format is not unstable; the
*label* is. Whatever else is or is not ready, a 1.0 has to make the version
string start carrying information, because right now it carries none:

- `version` is optional on both file kinds (§6.1, §7.1) and is declared as
  `z.string().optional()` in `ts/packages/core/src/manifest.ts:153` and
  `ts/packages/core/src/geometry/schema.ts:200`. Neither reader ever looks at
  the value. The C# reader does not either.
- `SPEC_VERSION = '0.9'` exists in exactly one place,
  `ts/packages/core/src/geometry/serialize.ts:15`, and is used only to *write*
  the field, never to compare against one.
- So a reader cannot tell a document from July from one from September, and a
  document cannot tell a reader it needs a newer one. The field is decoration.

That is a defensible design — plenty of formats say the version is advisory —
but it is not written down anywhere, and silence is the one thing a 1.0 cannot
leave here.

---

## 2. Section by section

Status is against the 0.9 mark (`cccdd2d`, 2026-07-16), not against the first
draft. "Stable" means: unchanged since the mark, pinned by a test or fixture,
and implemented the same way by both readers.

| § | Title | Status | Evidence |
|---|---|---|---|
| 1 | Overview | Stable | Prose. Nothing normative. |
| 2 | Terminology | Stable | Glossary. Nothing normative. |
| 3 | Folder structure | Stable | `test/part-geometry.test.ts:208-235`, `test/lint-runner.test.ts:181,194` |
| 4 | Coordinate system | Stable | `test/rig-transform.test.ts:36,48`; C# `RigTransformTests` |
| 5 | Identifiers | Stable | `test/identifier.test.ts` entire; C# `IdentifierTests`; fixtures `*/invalid-value/bad-part-name.json` |
| 6.1 | Manifest top-level | **Changed** | Palette semantics moved (`fd0ff25`); `sockets`, `openBoundaries` rows added since. `test/manifest.test.ts:220` |
| 6.2 | Part object | **Changed** | Rest `scale` added 2026-08-26 (`4b22297`). Pinned by `test/manifest.test.ts:133` and `test/rig-transform.test.ts:305`. No shipped model uses it; 16 production packages do |
| 6.3 | Animation map | Stable | `test/project.test.ts:211-218`; all nine models use the string-path form |
| 6.4 | Inline animation | Stable | Exercised through §6.3/§6.7; three models carry an inline clip (`herbalist`, `owl`, `windmill`) |
| 6.5 | Keyframe values | Stable | `test/animation.test.ts:233`, `test/corpus-coverage.test.ts:292-338` |
| 6.6 | Time keys | **Changed** | `212e8dc` (2026-08-08) made the decimal point mandatory. `test/manifest.test.ts:767-770` |
| 6.7 | Interpolation | **Changed** | Three rules the reference did not keep were fixed in `459d2d3`; endpoint clamping in `b2d36ac`. `test/easing.test.ts` entire, `test/animation.test.ts:69,84,162,331,422,433` |
| 6.8 | Missing parts | Stable | `test/manifest.test.ts:941` |
| 6.9 | Geometry list | Stable | `test/manifest.test.ts:196`; seven of the nine models declare a list, six of those name more than one file |
| 6.10 | External palette | Stable | `test/palette-file.test.ts` entire; seven of the nine models ship a `palette.json` their geometry files reference |
| 6.11 | Concurrency | **Open question** | No test, no fixture, in either implementation. Not a property of a document — no manifest can declare two clips running at once — so nothing can check it. See §3. |
| 6.12 | Published sockets | **New since the mark** | Added `626d83a`. `test/socket-frame.test.ts:11`, `test/cross-file.test.ts:244-247`; used by `knight` (2), `submersible` (4), `orrery` (1) |
| 6.13 | Part geometry | **New since the mark** | Added `439d0eb`. `test/part-geometry.test.ts:9-24`; the inline form is used by one model (`orrery`) |
| 6.14 | Open boundaries | **New since the mark** | Added `db730d1`, ten days ago. `test/open-boundary.test.ts` entire, two negative fixtures. No shipped model uses it and there is no positive fixture; 2 production packages already do — see §3 |
| 7.1 | Geometry file structure | **Changed** | Gained the palette (`fd0ff25`) |
| 7.4 | Palette | **Changed** | Materials (`228c68e`), alpha (`004b2bc`), the 64 cap (`37de2e7`), and the statement of what two implementations must agree on about a mesh (`db771f3`). The most-cited section in the suite: `test/palette-material.test.ts`, `test/mesh.test.ts:9,111,151`, `test/render-scene.test.ts:106-290`. Material objects have zero production users; alpha has one colour, in six packages |
| 7.5 | Part object | Stable | `test/geometry-parse.test.ts:108,132` |
| 7.6 | `size` | Stable | `test/geometry-parse.test.ts`; W04/W05 |
| 7.7 | `pivot` | **Changed** | Rotated-parent composition specified in `13f4acb`. `test/rig-transform.test.ts:91,328`, and `partPlacement` in `@cuboidy/three` is the one restatement both renderers read |
| 7.8 | `sockets` | **Changed** | `b59f8ac` — scale moves a socket. `test/socket-frame.test.ts:113-179` |
| 7.9 | `voxels` | Stable | `test/geometry-parse.test.ts`; `wrong-arity` fixtures |
| 7.10 | Voxel row | **Changed** | `$` and `%` added `37de2e7`. Cited in source (`src/geometry/schema.ts:35`) and C# (`Geometry/VoxelRow.cs:37,50`); no test names the section, though the alphabet is covered by `invalid-value/bad-voxel-char.json` |
| 8 | Reference paths | **Open question** | Rules pinned by `test/lint-runner.test.ts:338,360` and `test/json-schema.test.ts:136,151`. The `../` allowance is where §3's self-containment and real use pull apart — see S7 |
| 9 | Encoding | Stable | No TS test names it. C# does, explicitly: `GeometryReaderTests.cs:258`, `PackageLoaderTests.cs:140` ("SPEC §9 forbids a BOM") |
| 10 | Defaults summary | Stable | Derived table; each default tested at its own section. C# `GeometryReaderTests.cs:32` names it |
| 11 | Validation and lint | **Changed** | W09-W11 added `e9d1ee4` (2026-09-11), H05 added `db730d1` (2026-09-12). Heavily pinned: `test/fixtures-parity.test.ts`, `test/cross-file.test.ts` entire. **H03 is missing from the document** — see §3 |
| 12 | Reference examples | **Stale** | Names six models; `models/` holds nine. `herbalist`, `orrery` and `submersible` are not in the list |
| 13 | Packed format | **New since the mark, and not in the reference implementation** | Added `1fe3e9d`. Implemented in `ts/packages/editor/src/lib/load-model.ts:47-144` and tested there (41 cases in `test/load-model.test.ts`). Not in `@cuboidy/core`, not in C#, and there is no `.cuboidy` fixture anywhere in the repository |
| 14 | Future extensions | Stable | The deferral list itself: blending (§6.11), custom easing curves (§6.7), rig vocabularies, IK, composition, per-attachment overrides |
| 15 | Acknowledgments | Stable | Prose |

### What the two implementations agree on

This is the strongest evidence in the file and it deserves its own paragraph.
`csharp/Cuboidy.Tests/parity/{runtime,mesh}.txt` are generated from the TS
reference by `ts/packages/core/scripts/dump-parity.ts` — every model, every
clip, sampled at `k·duration/24` for `k = -1..25`, plus a face-count and
FNV-1a digest over the sorted mesh. Regenerating them today produced **no
diff**: 5355 runtime lines and 5243 mesh lines identical to what is committed.
`dotnet test` then passes 409 tests against them. So the agreement is between
today's TypeScript and today's C#, not between C# and a stale artifact.

### What a production corpus exercises, and what it does not

Tropalm carries 97 Cuboidy packages under one namespace — 126 geometry files
holding 438 distinct shape parts, placed by 449 rig-part entries, plus 92
standalone animation clips. It consumes the C# reader directly
(`Tropalm.Godot.csproj:46` is a `ProjectReference` to `csharp/Cuboidy`, with a
comment saying it becomes a `PackageReference` once that package is
published), so what the loader supports is the whole of §6 and §7 — what
follows is a census of the *content*, not of the reader. It is the only
evidence available of what the format looks like when somebody has to live in
it, so it is worth reading as a coverage report.

Exercised hard:

- §6.2 hierarchy — 346 of the 449 rig-part entries declare a `parent`, in 26
  packages. The longest chain is six links deep (`scorpion`:
  `body → tail-1 … tail-5 → stinger`).
- §6.2 rest `rotation` (16 packages) and rest `scale` (the same 16). **The
  rest `scale` added a month ago and used by no reference model is used in
  production**, which is the reverse of what C4 would predict.
- §6.3 clip references — 22 packages, 92 clip files, **every one a string
  path**. Not one inline animation object (§6.4) in 97 packages.
- §6.7 easing — 2,146 keyframes carry an `ease`, always the per-attribute
  object form (`"ease": { "rot": "in-out-sine" }`). Eleven of the twenty
  presets appear, and the distribution is steep: `in-out-sine` alone is 1,804
  of them. Nine are never used at all — `step`, every `-bounce`, `in-back`,
  `in-elastic`, `in-out-quad`, `in-out-elastic`, `in-out-back`.
- §6.5 `visible` — 300 keyframes across 5 packages, almost all of it four
  eight-frame flipbooks (`campfire`, `furnace`, `torch`, `wall_torch`), which
  sits inside H04's 4-8 band.
- §6.3 `loop: false` — 19 of the 92 clips are one-shots.
- §6.9 multi-file geometry — 17 packages name more than one file.
- §6.10 external palettes — **universal**. All 126 geometry files reference a
  palette file; not one spells out an inline colour array.
- §6.12 and §7.8 sockets — 10 packages publish exactly one, all named `grip`;
  4 of the 10 declared sockets carry a `rot`.
- §6.13 reference-form part geometry — 20 parts across 2 packages (`agent` 19,
  `guitar` 1), used for shape reuse: eleven of `agent`'s joints point at one
  shared `bone` cuboid, and `guitar` reaches into `agent`'s folder for its own.
- §6.14 `openBoundaries` — 2 packages, ten days after it was specified, and
  exactly the case §6.14 was written for: `bed_head` declares `+z` and
  `bed_foot` declares `-z`.

Untouched in 97 packages:

- §7.4's material objects. **Zero of 192 palette entries.** Every one is a
  plain hex string. Metallic, roughness and emissive — the largest grammar
  addition of August, and the one with the most test citations in the
  repository — have no production user, though Tropalm's Godot shim implements
  them in full.
- §7.4 alpha — **one entry in the whole corpus**: `palette_glass.json` index 8,
  `#FFFFFF66`, which six bottle packages draw on. One colour is not nothing,
  but it is not coverage either.
- §6.13 *inline* part geometry. Zero — the 20 above are all the reference form.
- §7.7 `pivot.rot`. Zero; every rest rotation goes through §6.2 instead.
- §7.6's upper range. The largest axis on any part is 27; the cap is 1024.
- §13. No `.cuboidy` archive exists anywhere in Tropalm, and no unpacking code
  either.

And one finding that is neither: **118 of the 126 geometry files resolve their
palette outside their own package** — 112 through `../../palette.json`, a
single 64-colour palette shared by the whole corpus two directories up, and 6
through `../../palette_glass.json`. §8 permits the path and then warns that it
leaves the package, and that a folder-scoped tool "cannot resolve it and
reports it as unreadable". The browser editor is exactly such a tool. So the
reference editor cannot open the majority of the largest corpus the format
has, by the spec's own design. 95 of the 97 packages reach outside for a
palette; `agent` is the only self-contained one, and `guitar` reaches into
`agent`'s folder instead. None of the 95 could be zipped per §13 without
carrying a palette it does not contain. See S7.

Worth saying plainly: the corpus adds **no keys of its own**. Every top-level
and part-level key in 97 packages is one §6 defines. Nothing in production has
had to reach past the format.

The C# port has also kept up with every format change since the mark:
`openBoundaries` (`csharp/Cuboidy/OpenBoundary.cs`), the rest `scale`
(`Manifest.cs:53`), the `$`/`%` alphabet (`Geometry/VoxelRow.cs:37`), and
materials and alpha (`Geometry/Palette.cs`). The only deliberate absences are
lint and the palette range check, both documented in
`docs/csharp-implementation.md:113-160`, and §13.

---

## 3. What a 1.0 must close or say it is deferring

### Spec-level — these change what the document means

**S1. The version field means nothing, and "0.9" has absorbed eight additions.**
Detailed in §1. A 1.0 must state what a reader does when it meets a version it
does not know — reject, read what it can, or ignore the field — and if the
answer is "ignore", the spec has to say so rather than leaving a reader to
infer it from an implementation. Until then, "version": "1.0" is a promise
with nothing behind it.

**S2. H03 is implemented and undocumented.** `ts/packages/core/src/diagnostic.ts:37-39`
declares `H03` — "a geometry file's inline palette is shadowed by the manifest
binding" — and `grep H03 SPEC.md` returns nothing. §11.4's hint table lists
H01 and H02; H04 and H05 arrive in §11.6; H03 is absent from both. A second
implementation written from SPEC.md alone cannot produce a hint the reference
does. Either write it down or remove it.

**S3. §13 is normative and the reference implementation does not read it.**
The spec defines a container; `@cuboidy/core` has no ZIP reader, so the
package that §7's own text calls the reference cannot open one. The only
reader is the editor's, with its own walk and its own safety checks, and there
is no shared fixture for it the way `fixtures/` covers §6, §7 and §11 — so the
one part of the format with an attack surface (path traversal, absolute
entries, entry-count bounds) has no cross-implementation contract. Either core
gains it, or §13 is restated as an optional companion container that a
conforming reader need not support.

**S4. §6.11 cannot be checked and nothing says so.** "At most one active
animation at a time" is a constraint on a runtime, not on a document. Neither
implementation tests it, and neither could: no manifest can express two clips
playing at once. A 1.0 should mark it explicitly as a consumer obligation
outside the validator's reach, so that "every section has a test" stops being
a bar it silently fails.

**S5. `duplicate` animation name is marked "(planned)".** `SPEC.md:1012` lists
it in the structural-code table and `SPEC.md:1017` admits the row is not
implemented — in either reader. A specification that ships with an
unimplemented normative row is exactly what a 1.0 is supposed to end: implement
it, or delete the row.

**S6. §12's example list is stale.** Six models named, nine shipped. Small, but
§12 is a claim about the repository that is checkable and currently false.

**S7. §3 says self-contained, §8 permits leaving, and production left.** §3
defines a model as a self-contained folder; §8 allows `../shared/walk.json`
and then warns it may not load. 95 of the 97 packages in Tropalm's corpus
reach outside their own folder for their palette, so the pattern the spec
discourages is the one a real library converged on — because a shared palette
across 97 packages is a genuine need and the format has no other way to
express it. A
1.0 has to pick: either the self-containment rule wins and the spec says a
conforming package must not reference outside its folder (making that corpus
non-conforming and pushing it to copy the palette per package), or the escape
is blessed with a name — a workspace-level shared file — and the folder-scoped
constraint becomes a documented tool limitation rather than an authoring
warning. Leaving both sentences standing is what produced a corpus the
reference editor cannot open.

### Code-level — these do not change the format, and would embarrass a 1.0

**C1. `npm run verify` has been red in core since 2026-08-26.** Four
`TS2345`s in `ts/packages/core/test/rig-transform.test.ts:336,342,349,356`:
`Frame.pos` is `[number, number, number]` (`src/rig-transform.ts:100-103`) and
`Vec3Tuple` is `readonly [number, number, number]`
(`src/geometry/types.ts:27`), so a `Vec3Tuple` cannot be passed where a
`Frame` is wanted. It arrived with `4b22297`, the rest-scale commit, and has
stood for four weeks because `npm test` is green — vitest runs the tests
through esbuild, which strips types without reading them — and because nothing
runs `verify` automatically. `src/` is unaffected: core's build uses
`tsconfig.json`, whose `include` is `src/**/*` only, so the published `dist` is
correct. Note that `docs/working/refactor-backlog.md:66` says "Treat R3-g as
fully closed"; the readonly/mutable split it claims to have closed is what
this is.

**C2. There is no CI.** No `.github/`, no hooks. C1 is the proof that this
costs something: a red gate that nobody runs is not a gate. This is the single
cheapest item on the list and it is upstream of most of the others.

**C3. The geometry JSON Schema has no drift test.**
`test/json-schema.test.ts:237-245` asserts the committed
`schema/cuboidy.schema.json` equals `buildManifestJsonSchema()`'s output.
There is no equivalent for `schema/cuboidy-geometry.schema.json` against
`buildGeometryJsonSchema()` (`src/json-schema.ts:81-88`) — it can drift from
its generator silently. Publishing a schema that does not match the validator
is worse than publishing none.

**C4. The reference corpus is behind the format it is supposed to demonstrate.**
`openBoundaries` (§6.14) appears in two *negative* fixtures and nowhere else —
no shipped model declares one, so the bake it controls is proven only by unit
tests. The rest `scale` on a manifest part (§6.2) appears in zero models: every
`"scale"` under `models/` is a keyframe value, not a rest value. Production
uses both (2 packages and 16 packages respectively), which is the argument that
they work — and also the argument that `models/` has stopped being the place
the format is demonstrated. Each needs a model, or at minimum a positive
fixture, before a 1.0 can claim the reference corpus covers the format.

The mirror of this is worth noting next to it: §7.4's material objects have
heavy test coverage, a `models-test/` package, a full implementation in
Tropalm's Godot shim — and **zero** users across 97 production packages. Alpha
has exactly one colour in one shared palette. Tested is not the same as used,
in either direction, and a 1.0 should know which of its features are which.

**C5. Comment rot from the 64-colour change.**
`ts/packages/core/src/result.ts:33` and `csharp/Cuboidy/Result.cs:32` both say
"palette exceeding 62 colors"; the cap is 64 (`MAX_PALETTE`,
`src/geometry/palette.ts:6`, and `SPEC.md:591`). `csharp/Cuboidy/Diagnostic.cs:4`
says the vocabulary is "W01..W11, H01..H04" — H05 exists. Trivial, and the
kind of thing a reader uses to decide whether to trust the rest.

### Explicitly deferred, and correctly so

§14's list — blending, custom easing curves, rig vocabularies, IK,
composition, per-attachment overrides — is a deferral the document already
makes in the open. None of it blocks a 1.0. Composition in particular is
argued out in the root README's roadmap: an attachment is a property of a
scene, not of a model, so it belongs above the format. That argument is the
right one and should survive into 1.0 unchanged.

---

## 4. Verdict on the spec

**1.0 after seven items: S1-S7.**

The format is in much better shape than "0.9 (draft), subject to change"
suggests. Two independent implementations produce byte-identical output over
every model, every clip and 27 sample times; 872 tests in TypeScript and 409 in
C# stand behind it; a shared fixture corpus is the cross-implementation
contract and both sides pass it; nine reference models were authored from the
document alone; and 97 packages in production added not one key of their own.
That last number is the strongest single piece of evidence in this file — a
format nobody had to extend to ship with is a format that is mostly finished.

What is not ready is the versioning contract, and it is the one thing 1.0 is
*for*. Today `"version": "0.9"` is written by the serializer, read by nobody,
and has meant eight different grammars since July. Shipping 1.0 without S1 just
moves that problem to a rounder number. S2-S6 are smaller — a hint the
document forgot, a section the reference implementation does not implement, a
section nothing can check, a row admitted to be unimplemented, a list of six
where there are nine — but each is a place where the document and the code
disagree, and a 1.0 is a claim that they do not. S7 is the one with a real
design decision inside it, and the only one where production has already voted.

None of the seven needs a format change, though S7 may want one. S1 needs a
paragraph and a decision; S2, S5 and S6 are edits; S3 and S4 are scope
statements; S7 is a ruling plus whichever of two sentences survives. That is a
week of document work and one decision, not a redesign.

The code-level list (C1-C5) does not block a 1.0 of the *spec*, but C2 — no CI
— is what let C1 stand for four weeks, and I would not sign a 1.0 of anything
while the only thing checking it is somebody remembering to.

**The one argument for staying 0.x**, if the owner weighs it differently: if a
1.0 is meant to mean "every normative field is exercised by a reference model",
C4 becomes a blocker and the count goes to nine — two models to author for
§6.14 and §6.2's rest `scale`, which are both under a month old and used by no
shipped model. I do not think it should be. Both are used in production, both
have unit tests, and the C# port implements both; what `models/` is behind on
is demonstration, not proof. But it is the honest counter-case, and it is
cheap to close if the owner wants the stronger claim.

---

## 5. Package maturity

Counts are from `npm test --workspaces` (the passing totals, not a grep) and
from each barrel's exports.

| Package | API surface | Tests | Docs | Breaking-change risk | Publish-ready |
|---|---|---|---|---|---|
| `@cuboidy/core` | 161 exports (102 values, 59 types) + 8 CLI binaries, 12,743 lines | 872 vitest, plus 409 C# tests against its output | README 98 lines; `docs/csharp-implementation.md` is effectively its design record | **Low.** The surface has been stable through two audits; the risk is its size — 161 names is a lot of promise, and R3-j (does the scene domain belong here?) is undecided | **Publishable (not yet published), as of 2026-09-22.** `npm view @cuboidy/core` is 404 — this row previously said "Published at 0.9.0," which was wrong. 129 files, 162 kB packed, no `src`, no maps |
| `@cuboidy/three` | 36 exports (26 values, 10 types), 1,194 lines | 23 vitest — thin, but its arithmetic is checked through core's parity and both E2E suites | README 145 lines, including the CDN route | **None.** R3-h closed: the public entry is `buildRigTreeOf(parts, manifest)` only, every caller moved, no `Geometry`-taking alias survives — so there is no longer a semver-major waiting behind a publish | **Publishable (not yet published), as of 2026-09-22.** `npm view @cuboidy/three` is 404 — this row previously said "Published at 0.9.0," which was wrong. 31 files, 727 kB packed (the two browser maps are most of it, deliberately) |
| `@cuboidy/r3f` | 12 exports, 1,184 lines | **0** | README 58 lines | **Medium.** `RiggedParts`' `gizmos` prop is now optional (default all-false), so R3-h's half of this row is closed; the props interface is still 11 fields wide and has never had to survive an outside caller | **No.** Zero tests on a component surface is not a thing to put a version number on |
| `@cuboidy/ui` | 62 exports, 2,120 lines | **0** | README 34 lines | **High.** Editor chrome shaped by exactly two consumers, both in this repository. Open question R1-f (where does shared non-React browser code live) would move part of it | **No.** Same reason, plus it has no reason to be public yet |
| `@cuboidy/editor` | App, no barrel, 12,038 lines | 167 vitest + 12 Playwright | README 88 lines | n/a — a site, not a dependency | n/a. It is the only reader of §13 |
| `@cuboidy/workspace` | App, no barrel, 4,608 lines | 90 vitest + 93 Playwright | **None** | n/a — a site, not a dependency | n/a. Its E2E suite is the largest in the repository and flakes cold; rerun once before believing a red |

Two notes the table cannot hold.

**The two publish-ready packages are the two that earned it.** Core is the
only package with a second implementation checking it, and three is the only
one with a browser artifact anybody outside this repository can use. The
other four are either untested (r3f, ui) or not libraries (editor,
workspace). Publishing exactly these two is the right cut and would still
be the right cut if the spec stayed 0.x. **Neither is actually published
yet** — `npm view @cuboidy/core` / `@cuboidy/three` both 404 as of
2026-09-22. This section previously said "Published at 0.9.0" for both; that
was wrong, and the owner ruling on board card Q-cub2 is to fix the API debt
below before publishing at all, not after.

**The API debt inside the publish-ready set was R3-h — now closed.**
`buildRigTree(geometry, manifest)` and the required `gizmos` prop were
flagged in `docs/working/refactor-backlog.md` before this doc was first
written and were still live as of this doc's original text:
`ts/packages/three/src/rig.ts:142-147`,
`ts/packages/r3f/src/RiggedParts.tsx:10-38`, and
`ts/packages/workspace/src/lib/model-view.ts:7-14`, which synthesized a
throwaway `Geometry` with a borrowed file-level palette purely to satisfy
`buildRigTree`'s signature. As of 2026-09-22: `buildRigTree` is deleted,
`buildRigTreeOf(parts, manifest)` is the only public entry three's index
exports, every caller (`AnimationViewport.tsx`, `VoxelScene.tsx`,
`InstanceMesh.tsx`) moved to it, and no alias survives. `RiggedParts`'
`gizmos` prop is now optional (default all-false), so
`InstanceMesh.tsx`'s all-false constant is gone too. The
"semver-major after publish" risk this row warned about no longer applies —
there was never a publish to be major against, and the shape a publish
would freeze is now the one the package wants.
