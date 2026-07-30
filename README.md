# Cuboidy

An open text-based file format for voxel character models, rigs, and animations.

**Status: v0.9 draft. See [SPEC.md](SPEC.md) for the formal specification.**

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

A minimal Cuboidy voxel definition (`voxels.json`) — a `crown` part, 3×2×3 voxels, gold:

```json
{
  "version": "0.9",
  "palette": ["#FFD700"],
  "parts": [
    {
      "name": "crown",
      "size": [3, 2, 3],
      "pivot": { "pos": [1, 0, 1] },
      "voxels": [
        ["000", "000", "000"],
        ["0.0", "...", "0.0"]
      ]
    }
  ]
}
```

`voxels` is positionally indexed: one entry per Y-layer, one string per Z row,
one character per X cell. `.` is air; every other character is a palette index
(`0-9a-zA-Z`, hence the 62-colour cap). `size` is `[W, H, D]` and the arrays
must agree with it. See SPEC §7 for the full shape.

## Folder layout

A Cuboidy model is a **folder**, not a single file:

```
my-model/
├── cuboidy.json        manifest: rig hierarchy + animations (+ references)
├── voxels.json       voxel definition: palette + per-part grid + pivots + sockets
└── anims/            (optional) shared animations
    └── walk.json
```

For distribution, the folder can be packed into a single ZIP:

```
my-model.cuboidy        packed package (ZIP of the folder above)
```

| File | Role | Format | Validation |
|---|---|---|---|
| `cuboidy.json` | manifest (fixed name) | JSON | `parseManifest()` (TS reference impl) + shared JSON Schema (`schema/cuboidy.schema.json`) |
| `voxels.json` | voxel definition | JSON | `parseGeometry()` (TS reference impl) + shared JSON Schema (`schema/cuboidy-geometry.schema.json`) + `cuboidy-lint` CLI |
| `anims/*.json` | optional shared animations | JSON | same inline-animation schema + semantic rules (§6.6), resolved and checked by lint and the inspection CLIs |
| `*.cuboidy` | packed package | ZIP | both, after extraction (packed format is reserved for a future spec version) |

## Examples

Models live under `models/`:

- `models/wolf/` — multi-part rig (body / head / tail / four legs) with idle animation, sockets for `hat` and `mouth`
- `models/cat/` — quadruped with pointy ears, vertical tail, and belly markings; idle tail-twitch animation
- `models/crown/` — single-part static accessory, designed to attach to wolf's `hat` socket
- `models/boy/`, `models/girl/` — humanoid rigs (head / body / arms / legs) in standard, `-chibi`, and `-mini` proportions
- `models/robo-mini/` — v0.7+ project-feature demo: manifest `geometry` list (two geometry files) and external `palette.json` binding (§6.9/§6.10)

## Inspecting models

Four CLIs assemble a model (rest pose — translation only, pivot/animation rotations are not applied) for inspection:

- **`cuboidy-snap <dir>`** — renders the model to **PNG images from several angles** (a contact sheet plus one PNG per angle), with the angle name and an XYZ axis gnomon baked into each. It is the image counterpart of `cuboidy-view`; the intended workflow is to render a model, look at the pictures, and refine the voxels. Dependency-free — a small software rasterizer + pure-Node (`zlib`) PNG encoder, no browser or native bindings.

  ```
  cuboidy-snap models/cat                       # → models/cat/snapshots/{contact,front,…}.png
  cuboidy-snap models/cat --angles=cardinal --size=512
  ```

  The default is the seven-view **standard** set: four three-quarter corners from above plus front / right-side / top. Other groups: `cardinal` (six faces), `corners` (four), `all`; or list ids directly (`front back side left top bottom fr-up fl-up br-up bl-up`).

- **`cuboidy-view <dir>`** — orthographic projections as **ASCII grids** of palette-index characters (the `voxels.json` alphabet), for a token-cheap textual read.
- **`cuboidy-query <dir> --at=x,y,z`** — exact voxel lookup at world coordinates (fractional-safe; the precise tool when half-voxel offsets are present).
- **`cuboidy-lint <dir>`** — voxel-definition + cross-file lint.
- **`cuboidy-part`** — author concrete geometry (the way symmetric limbs / repeated parts are made — an AI generator runs this instead of hand-writing mirrored voxels):
  - `cuboidy-part duplicate <from.json> <fromPart> <to.json> <toPart>` — copy a part (cross-file copies remap the palette so colors are preserved).
  - `cuboidy-part mirror <file.json> <part> [axis]` — reflect a part **in place** across `axis` (default `x`). A bilateral pair is *duplicate, then mirror the copy*.

## Token cost

Cuboidy is meant to be cheap to send to an LLM, and for a long time this
section claimed a bespoke text format was how that was achieved. That claim was
measured in 2026-07 and did not hold.

In a real authoring turn — spec in, model out — **reasoning is 77-93% of the
output cost**. The geometry file is around 7% of what a sample costs to
generate; the rest is the model thinking about shape. A 30-50% difference in
file size therefore moves the bill by single digits, which does not pay for a
bespoke parser, its grammar specification, and a barrier to every non-Claude
implementation. On quality, a blind pairwise vote over four briefs went **4-0
for JSON** (p = 0.125 — suggestive, not significant), and one non-Claude model
could not produce the text format at all while writing the JSON manifest
correctly.

So geometry is JSON, and the efficiency work that matters happens elsewhere:
the voxel-row alphabet keeps a grid at one character per cell, and
`cuboidy-view` / `cuboidy-query` exist so a model can inspect a model without
re-reading the whole file.

Evidence, method and the limits of the sample: [`docs/eval/`](docs/eval/).

## Roadmap

- [x] Spec document (`SPEC.md`) — v0.9 draft (multi-file geometry, shareable external palettes, keyframe easing, per-part rest rotation)
- [x] Reference parser (TypeScript) — `ts/packages/core/`, full v0.9 grammar (554 tests)
- [x] Shared project loader — `resolveProject()`: manifest geometry list, external palette, external animations; used by lint, the inspection CLIs and the editor
- [x] Cross-file lint — project-shaped validation (`validateProject`): manifest↔geometry part matching, cross-file duplicate names, palette resolution/range, animation target checks, W06 geometric l/r symmetry, W07 unreferenced geometry file, H03 shadowed inline palette
- [x] Shared parity fixtures — `fixtures/geometry/<code>/` and `fixtures/manifest/<code>/`, contract for cross-implementation conformance
- [x] JSON Schema for `cuboidy.json` — `schema/cuboidy.schema.json` (Draft 2020-12, derived from the Zod ManifestSchema; reference via `"$schema": "https://cuboidy.com/schema/cuboidy.schema.json"` or the GitHub raw URL)
- [x] Canonical serializer (reader-tolerant / writer-strict) — `serializeGeometry()` emits one canonical form per model; round-trip with `parseGeometry` verified as a byte-level fixed point on every shipped model
- [x] Voxel definition linter — `lintCvox(cvox)` library (W01–W05 + H01–H02) and `cuboidy-lint <dir>` CLI (SPEC §11.7 output, `--strict` for warnings-as-errors)
- [x] Model inspection CLIs — `cuboidy-view` (ASCII projection), `cuboidy-query` (exact coordinate lookup), and `cuboidy-snap` (multi-angle PNG renders; contact sheet + per-angle, dependency-free) for human / multimodal review
- [x] Image snapshots — `cuboidy-snap <dir>` renders a model to PNG from several angles, the raster counterpart to `cuboidy-view`, for visual review and AI-assisted editing
- [ ] Reference parser (C#)
- [~] Web-based editor (`ts/packages/editor/`) — loads folders / geometry files / `.cuboidy` ZIPs; Geometry / Rig / Anim views; part, palette and keyframe-animation editing with undo/redo; project-aware save/export (FSA writeback or ZIP); Playwright E2E suite. Run locally with `cd ts/packages/editor && npm run dev`
- [ ] Rig vocabulary docs (quadruped / biped / winged / ...)
- [ ] Packed format spec (`.cuboidy` ZIP)

## License

[MIT](LICENSE). The reference parser, examples, and specification are released
under the MIT license. Implementations in any language are encouraged.
