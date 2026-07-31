# Migrating geometry from `.cvox` to JSON

**Status: done, 2026-07-31.** Merged.
Decision taken after measuring the format's claimed advantages rather than
assuming them — see "Why" below.

| Commit | What |
|---|---|
| `092e544` | phases 0–3: the format, the reader/writer, the corpus, every consumer |
| `76fe4a1` | phase 4: `src/cvox/` deleted, survivors moved, fixtures rebuilt, docs |
| `19f29f6` | the `Cvox` → `Geometry` rename across core and the editor |

Final state: core 465 tests green, editor E2E 7/7, all five CLIs exit 0 on all
12 models, `GeometrySchema` validates 13/13 shipped geometry files. The only
`.cvox` strings left in `ts/` are three comments that name the removed format
on purpose.

## Why

`.cvox` existed to be token-cheap and AI-authorable. Both claims were measured
in `bench/eval` and neither survived at the scale that matters:

> `bench/` no longer exists on this branch. Every `bench/eval/...` path below is
> provenance, not a working reference: the harness lives on the unmerged branch
> `eval-format-comparison`, and the results it produced are in `docs/eval/`.
> Almost all of it died with the migration — the two-arm structure, the
> token-variant pricing and the cvox spec extraction have no meaning once there
> is one format — so it was never merged. The pieces with a future were promoted
> into the product instead, and the table below records which.

| Measurement | Result |
|---|---|
| Human blind pairwise vote (Sonnet 5, 4 briefs) | JSON 4–0 (p = 0.125 — suggestive, not decisive) |
| Reasoning share of output cost | **77–93%** — the geometry file drives single-digit % of the bill |
| Output tokens (Sonnet 5, 4/4 briefs) | cvox 11–27% *fewer* |
| Output tokens (Opus 5, 1 brief, confounded) | cvox 43% *more* |
| Non-Claude model (MiMo-V2.5) | cvox failed 2/2 — emitted annotated pseudo-format that does not parse |
| Specification size | JSON spec is **54%** of the cvox spec |

The token advantage is real but small relative to reasoning, and it is bought
with ~1,100 lines of hand-written parser, ~1,680 lines of parser tests, ~420
lines of grammar specification, a barrier to any third-party implementation,
and — on the evidence above — no measurable quality gain. A format that only
Claude can author is not an open format.

The earlier `bench/RESULTS.md` numbers do not contradict this: they were
measured with tiktoken (an OpenAI tokenizer) on synthetic grids built from
`solid()`/`hollow()` fills, priced file size alone, and never measured
generation quality or reasoning tokens. That benchmark was deleted in phase 4.

## Locked decisions

1. **Filename stays `voxels.json`.** `cuboidy.json` is the package entry point,
   so role is discoverable from there; the extension does not have to carry it.
2. **No transition period.** `.cvox` is removed, not deprecated. Nothing in the
   shipped tooling reads it after this migration.
3. **No comments.** JSON has none and no `comments` field is added. Under
   minified LLM I/O the parser drops inline comments anyway, so the capability
   was already notional.
4. **Version field aligns with the manifest.** Geometry uses `version`, the
   same optional spec-version string `cuboidy.json` already carries — not a
   separate `cuboidy` key.

## Target format

Voxel rows stay CVOX-style strings (`"0220"`, `.` = air): the grid stays
readable, the `0-9a-zA-Z` palette alphabet is unchanged, and `indexToChar` /
`charToIndex` are reused verbatim. Nesting is explicit, so layer and row
boundaries are structural rather than positional.

```json
{
  "version": "0.9",
  "palette": ["#6B6258", "#C5BFB5", "#1A1612"],
  "parts": [
    {
      "name": "head",
      "size": [5, 5, 5],
      "pivot": { "pos": [2, 0, 5] },
      "sockets": [{ "name": "hat", "pos": [2, 4, 3] }],
      "voxels": [
        [".111.", ".111.", "11111", "11111", "11111"],
        [".222.", ".111.", "00000", "00000", "00000"]
      ]
    }
  ]
}
```

Omission rules mirror the current writer exactly: absent `palette` means the
model binds an external one (§6.10); absent `pivot` means the §7.7 default
(bottom-center); absent `sockets` means none.

**Working drafts already exist and are verified.** `bench/eval/json-format.mjs`
reads this shape into the same `Cvox` AST and round-trips all 15 real geometry
files losslessly; `bench/eval/variants.mjs` (`cvoxToJson`) converts in the other
direction; `bench/eval/spec-json.md` is §7 rewritten for this container, with
every semantic clause carried over verbatim. Promote these rather than starting
over.

## Order of work

Add → switch → delete. Deleting first breaks every package at once and makes
failures unattributable; the end state is identical.

**Every phase ends green.** Flipping `refPath('.cvox')` early was tried and
reverted: it fails 57 tests immediately — every fixture manifest that names a
geometry file — and none of them can be fixed until the reader exists and the
data is converted. So the extension switch moves into Phase 2, where it lands
atomically with the reader and the converted files. Phases 0 and 1 add code that
nothing calls yet and change no behaviour.

### Phase 0 — define the format

- `ts/packages/core/src/geometry/schema.ts` — the Zod schema for the shape
  above, the single source of truth for both the runtime reader and the
  published artifact
- `schema/cuboidy-geometry.schema.json` — generated from it, alongside the
  existing manifest schema
- SPEC §7 replaced from `bench/eval/spec-json.md`; §11.3/§11.4 retitled (the
  W01–W05 voxel rules survive unchanged, only their headings mention `.cvox`)

Nothing imports the new schema yet, so the suite stays green.

*Verify:* generated schema validates every model converted with the eval
converter; existing tests unaffected; SPEC has no remaining grammar or lexical
section.

### Phase 1 — core reads and writes JSON

New `ts/packages/core/src/geometry/`:

| File | From |
|---|---|
| `types.ts` | moved from `cvox/types.ts` unchanged — the AST is format-independent |
| `parse.ts` | `bench/eval/json-format.mjs`, ported to TS with a zod schema and `Result<Geometry>` |
| `serialize.ts` | `variants.mjs` `formatJson` — inline coordinate triples, one Y-layer per line |
| `voxel-row.ts` | moved from `cvox/voxel-row.ts` — charset, width and palette-range checks are unchanged |
| `transform.ts` | moved from `cvox/transform.ts` — mirror/duplicate/remap operate on the AST |

`parseHexColor` and `MAX_PALETTE` move out of `cvox/palette.ts`; `PaletteParser`
(the text scanner) is deleted. `project.ts` resolves `voxels.json`.

*Verify:* every `models/*` and `fixtures/*` file converts, parses, and
re-serialises to itself; `lintCvox` and `validateProject` run unchanged on the
resulting AST.

### Phase 2 — convert the data

- `models/**/*.cvox` → `voxels.json` (15 files; `cvoxToJson` already does this)
- `fixtures/cvox/` → `fixtures/json/`
- manifests: `geometry` entries updated; the §6.9 default becomes
  `["voxels.json"]`
- `models/robo-mini` keeps its two-file geometry list — it is the multi-file
  regression case

*Verify:* `cuboidy-lint` clean on every model directory.

### Phase 3 — switch the consumers

- **CLIs** (`assemble`, `lint`, `part`, `query`, `snap`, `view` + runners):
  mostly reach geometry through `project.ts`; `cuboidy-part` additionally
  writes files and moves to the JSON serializer.
- **Editor**: `load-model.ts`, `App.tsx` (parse/serialize call sites),
  `ExportMenu`, `fileIcon`, `FileTree`, `save.ts`, `synthesize-manifest.ts`.
- **Diagnostics keep their line numbers.** cvox errors were prefixed `line N:`
  because the tokenizer carried line numbers; schema errors know only a
  document path (`parts.2.size`). `geometry/locate.ts` maps a path back to a
  line/column and `parseGeometryText` — the only entry point that holds the
  text — applies the prefix, so every consumer keeps the old behaviour with no
  call-site change and no new dependency. The `Result` error variant gained an
  optional `path` for callers that want the raw location.

  This was budgeted as the phase's one substantial rewrite on the assumption
  that cvox reported several spans at once. It did not — `parseCvox` returns a
  single `Result` error, same as the schema — so only the position mapping was
  actually missing.
- **Absent fields say so.** Zod describes a missing field by the type it
  wanted — "Invalid input: expected tuple, received undefined" for a forgotten
  `size` — which reads as a type error. Both readers now substitute "required
  field is missing" when the field is genuinely absent. The editor's banner
  label changed from "Syntax error" to "Error" for the same reason: most
  reports are schema violations in well-formed JSON.
- **Inline-comment tracking deleted.** `countInlineComments` and
  `droppedInlineComments` warned that non-header cvox comments would not
  round-trip. JSON has no comments (a locked decision), so the check could only
  produce false positives on `//` inside strings.

*Verify:* the editor opens every directory under `models/`; a deliberately
broken geometry file shows the error on the right line; export produces a
loadable package.

*Result:* core 615 tests green, editor E2E 7/7 (the A-6 broken-source spec now
asserts the reported line), `cuboidy-lint` clean on all 13 models, editor
typechecks and builds.

### Phase 4 — delete

`src/cvox/` is gone. The thirteen text-only modules (`tokenize`, `cursor`,
`expect`, `comment`, `numbers`, `header`, `parse`, `part`, `size`, `pivot`,
`socket`, `voxels`, `vec3`) and the text halves of `palette` and `serialize`
were deleted; the nine `test/cvox-*.test.ts` files went with them. What was
never about the container moved to `src/geometry/`:

| Moved to | From | Why it survives |
|---|---|---|
| `geometry/types.ts` | `cvox/types.ts` | the AST is format-independent |
| `geometry/transform.ts` | `cvox/transform.ts` | mirror/duplicate/remap operate on the AST |
| `geometry/voxel-row.ts` | `cvox/voxel-row.ts` | the §7.10 alphabet, minus the row scanner |
| `geometry/palette.ts` | `cvox/palette.ts` + `serializeColor` | the §7.4 colour codec, minus `PaletteParser` |
| `identifier.ts` | `cvox/reserved.ts` | the reserved list is now purely a §5 identifier rule |

No semantic case was lost. The rules the cvox tests guarded — dimension
agreement, palette index range, identifier rules, socket uniqueness, default
pivot — were already covered by `geometry-parse.test.ts`; the writer's omission
rules moved to a new `geometry-serialize.test.ts`, which the text-only
`cvox-serialize.test.ts` had been the sole guard for.

The parity fixtures were the other half of the work, because they are the
cross-implementation contract, not just tests: `fixtures/cvox/` → deleted,
`fixtures/json/` → `fixtures/manifest/`, and a new `fixtures/geometry/` with 15
JSON documents covering all five §11.2 codes. Seven of the cvox fixtures had no
JSON analogue at all (stray `,`, unclosed `voxels {`, duplicate `palette` — all
tokenizer artifacts), and JSON gained cases cvox could not express structurally
(duplicate part name, duplicate socket name, unknown part field). The parity
test now also fails on an empty code directory, so a directory cannot silently
lose its coverage.

The ~46 geometry fixtures in the loader/CLI tests were authored in the text
syntax and written out through a `geoFromText` bridge; all of them are now
`geo()` document literals and the bridge is deleted.

Docs: `docs/cvox-authoring.md` → `docs/geometry-authoring.md` (the loop,
coordinate model, pivot advice and case study were never about the container —
only the syntax examples changed). `README.md`'s "Token efficiency" section
made the claim this migration disproved and is replaced by what was actually
measured. The old tiktoken benchmark (`bench/RESULTS.md`, `compare-tokens.py`,
`generate-dataset.mjs`, `verify-cvox.mjs` and its generated dataset) is deleted:
its scripts referenced a format that no longer exists, and leaving a wrong
answer in the tree invites it being cited again. Git history keeps it; the
evidence that replaced it is in `docs/eval/`.

*Verify:* no `.cvox` string remains outside `docs/` history and three comments
that name the removed format on purpose; full test suite green; every CLI runs
against every model.

## Known trap

`ManifestSchema.geometry` is `z.array(refPath('.cvox'))`. A manifest that
correctly names `voxels.json` is rejected by the current tooling — this was hit
during the eval and worked around there at validation time only. It must be
fixed properly in Phase 0, or Phase 2 fails everywhere at once.
