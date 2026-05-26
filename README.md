# Cuboidy

An open text-based file format for voxel character models, rigs, and animations.

**Status: v0.6 draft. See [SPEC.md](SPEC.md) for the formal specification.**

## What it is

Cuboidy describes voxel characters as a hierarchy of rigid parts, with named attachment sockets and shareable keyframe animations. It combines ideas from several established formats:

- **Minecraft Bedrock** geometry/animation files — rigid part hierarchy, per-bone pivots
- **Mixamo** animation clips — cross-rig reusable animations bound by part name
- **MagicaVoxel** — voxel grid + inline palette
- **VRM** — named attachment points / standardized rig vocabulary (planned)

Files are JSON + plain text only. The format is designed to be:

- **Human-readable** — diff-friendly, editable in any text editor
- **AI-authorable** — structure favors generation reliability over byte efficiency
- **Browser-editable** — no proprietary binary, no native runtime dependencies
- **Self-contained** — no registry, no namespace lookups; everything resolves via filesystem

## At a glance

A minimal Cuboidy voxel definition (`voxels.cvox`) — a `crown` part, 3×2×3 voxels, gold:

```
palette #FFD700                    // gold

part crown
    size 3 2 3
    pivot 1 0 1
    voxels {
        000 000 000                // layer 0 — solid base
        ,
        0.0 ... 0.0                // layer 1 — 4 corner pillars (hollow top)
    }
```

Identifier names (part / socket) are bare tokens. The identifier rule (§5) excludes reserved keywords (`part`, `size`, `pivot`, …), so `part part` correctly fails as "invalid identifier" rather than parsing as a part literally named `part`. The `voxels { … }` block holds the voxel data; comma separates Y-layers (positional indexing). Inside the block, anything but `,` and `}` is interpreted as a voxel row — even strings that spell reserved words like `rot` or `size` are unambiguously voxel data. See SPEC §7 for the full grammar.

## Folder layout

A Cuboidy model is a **folder**, not a single file:

```
my-model/
├── cuboidy.json        manifest: rig hierarchy + animations (+ references)
├── voxels.cvox       voxel definition: palette + per-part grid + pivots + sockets
└── anims/            (optional) shared animations
    └── walk.json
```

For distribution, the folder can be packed into a single ZIP:

```
my-model.cuboidy        packed package (ZIP of the folder above)
```

| File | Role | Format | Validation |
|---|---|---|---|
| `cuboidy.json` | manifest (fixed name) | JSON | `parseManifest()` (TS reference impl); shared JSON Schema is planned (see roadmap) |
| `voxels.cvox` | voxel definition | custom text | `parseCvox()` (TS reference impl); standalone `cuboidy-lint` CLI is planned |
| `anims/*.json` | optional shared animations | JSON | not yet validated; planned alongside `cuboidy.schema.json` |
| `*.cuboidy` | packed package | ZIP | both, after extraction (packed format is reserved for a future spec version) |

## Examples

Models live under `models/`:

- `models/wolf/` — multi-part rig (body / head / tail / four legs) with idle animation, sockets for `hat` and `mouth`
- `models/crown/` — single-part static accessory, designed to attach to wolf's `hat` socket
- `models/boy/`, `models/girl/` — humanoid rigs (head / body / arms / legs) in standard, `-chibi`, and `-mini` proportions

## Token efficiency

Cuboidy is designed to be cheap to send to an LLM. Measured with real
tokenizers (tiktoken `o200k_base` / `cl100k_base`) on an 8-model dataset:

Sorted from largest to smallest. The baseline is canonical CVOX (the
form Cuboidy actually ships); other formats are compared against it.

| Format                                  | Total tokens | vs CVOX canonical | Readability |
| --------------------------------------- | -----------: | ----------------: | :---------: |
| JSON, pretty-printed                    |        7,295 |          +214.7 % |    ★★★☆☆    |
| JSON with voxel rows as strings, pretty |        4,114 |           +77.5 % |    ★★★★☆    |
| JSON, minified                          |        2,954 |           +27.4 % |    ★☆☆☆☆    |
| **CVOX, canonical (indented)**          |    **2,318** |  **0 % (baseline)** | **★★★★★** |
| JSON str + minified                     |        1,881 |           −18.9 % |    ★★☆☆☆    |
| **CVOX, unindented**                    |    **1,648** |       **−28.9 %** | **★★★★☆**   |
| **CVOX, single-line**                   |    **1,526** |       **−34.2 %** | **★★☆☆☆**   |

Readability rubric (subjective, but applied consistently):
**★★★★★** indented + multi-line + bare keywords (CVOX-native);
**★★★★☆** indented or per-row line breaks with semantic chunks visible;
**★★★☆☆** structured but voxel data buried in nested-int stacks;
**★★☆☆☆** single-line but voxel rows still visible as tokens or strings;
**★☆☆☆☆** single-line, all structural punctuation crammed together.

Taking canonical CVOX as the baseline, pretty-printed JSON costs
**~3.15× more tokens** for the same data while being *less* readable
(voxel cells one per line). And because SPEC §7 lets any whitespace
separate tokens, the *same* `.cvox` can be stored canonical for humans
and diffs, then stripped to unindented form (`★★★★☆`) for LLM prompts —
**~29 % fewer tokens** without losing the line-by-line structure.

Full methodology, dataset, and per-model numbers in
[`bench/RESULTS.md`](bench/RESULTS.md).

## Roadmap

- [x] Spec document (`SPEC.md`) — v0.6 draft
- [x] Reference parser (TypeScript) — `ts/packages/core/`, full v0.6 grammar (263 tests)
- [x] Cross-file lint — `missing` error / `unknown` warning between manifest and voxels
- [x] Shared parity fixtures — `fixtures/cvox/<code>/` and `fixtures/json/<code>/`, contract for cross-implementation conformance
- [x] JSON Schema for `cuboidy.json` — `schema/cuboidy.schema.json` (Draft 2020-12, derived from the Zod ManifestSchema; reference via `"$schema": "https://cuboidy.com/schema/cuboidy.schema.json"` or the GitHub raw URL)
- [x] Canonical serializer (reader-tolerant / writer-strict) — `serializeCvox(cvox)` produces canonical text; round-trip with `parseCvox` verified. **File header preserved** (SPEC §7.11.1); inline comments are advisory and intentionally not preserved (v0.6 policy)
- [x] Voxel definition linter — `lintCvox(cvox)` library (W01–W05 + H01–H02) and `cuboidy-lint <dir>` CLI (SPEC §11.7 output, `--strict` for warnings-as-errors)
- [ ] Reference parser (C#)
- [~] Web-based editor (`ts/packages/editor/`) — Stage A1 viewer scaffolded (Vite + React + react-three-fiber); drop a `.cvox` file, see voxels in 3D with orbit camera. Edit features deferred to Stage A2+. Run locally with `cd ts/packages/editor && npm run dev`
- [ ] Rig vocabulary docs (quadruped / biped / winged / ...)
- [ ] Packed format spec (`.cuboidy` ZIP)

## License

[MIT](LICENSE). The reference parser, examples, and specification are released
under the MIT license. Implementations in any language are encouraged.
