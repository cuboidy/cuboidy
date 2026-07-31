# Cuboidy

An open JSON file format for voxel character models, rigs, and animations.

**Status: v0.9 draft. See [SPEC.md](SPEC.md) for the formal specification.**

## What it is

Cuboidy describes voxel characters as a hierarchy of rigid parts, with named attachment sockets and shareable keyframe animations. It combines ideas from several established formats:

- **Minecraft Bedrock** geometry/animation files — rigid part hierarchy, per-bone pivots
- **Mixamo** animation clips — cross-rig reusable animations bound by part name
- **MagicaVoxel** — voxel grid + inline palette
- **VRM** — named attachment points / standardized rig vocabulary (planned)

Every file is JSON. The format is designed to be:

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
├── cuboidy.json     manifest: rig hierarchy + animations (+ references)
├── voxels.json      voxel definition: palette + per-part grid + pivots + sockets
└── anims/           (optional) shared animations
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
- `models/robo-mini/` — project-feature demo: a manifest `geometry` list (two geometry files) that both point at one shared `palette.json` (§6.9/§7.4)

## Inspecting models

Four CLIs assemble a model in its rest pose and report on it; animation poses
are never applied. Rest rotations (`rotation`, `pivot.rot`) are handled two
ways: `cuboidy-snap` draws them as truly oriented cubes, while the
integer-lattice tools (`cuboidy-view` / `cuboidy-query`) put a rotated part's
pivot exactly where the rig puts it but keep the part's own voxels
axis-aligned, and emit a warning saying so.

- **`cuboidy-snap <dir>`** — renders the model to **PNG images from several angles** (a contact sheet plus one PNG per angle), with the angle name and an XYZ axis gnomon baked into each. It is the image counterpart of `cuboidy-view`; the intended workflow is to render a model, look at the pictures, and refine the voxels. Dependency-free — a small software rasterizer + pure-Node (`zlib`) PNG encoder, no browser or native bindings.

  ```
  cuboidy-snap models/cat                       # → models/cat/snapshots/{contact,front,…}.png
  cuboidy-snap models/cat --angles=cardinal --size=512
  ```

  The default is the seven-view **standard** set: four three-quarter corners from above plus front / right-side / top. Other groups: `cardinal` (six faces), `corners` (four), `all`; or list ids directly (`front back side left top bottom fr-up fl-up br-up bl-up`).

- **`cuboidy-view <dir>`** — orthographic projections as **ASCII grids** of palette-index characters (the `voxels.json` alphabet), for a token-cheap textual read.
- **`cuboidy-query <dir> --at=x,y,z`** — exact voxel lookup at world coordinates (fractional-safe; the precise tool when half-voxel offsets are present).
- **`cuboidy-lint <dir>`** — voxel-definition + cross-file lint.

A fifth CLI writes rather than reads:

- **`cuboidy-part`** — author concrete geometry (the way symmetric limbs / repeated parts are made — an AI generator runs this instead of hand-writing mirrored voxels):
  - `cuboidy-part duplicate <from.json> <fromPart> <to.json> <toPart>` — copy a part (cross-file copies remap the palette so colors are preserved).
  - `cuboidy-part mirror <file.json> <part> [axis]` — reflect a part **in place** across `axis` (default `x`). A bilateral pair is *duplicate, then mirror the copy*.

## Token cost

Cuboidy is meant to be cheap to send to an LLM, but not by shrinking the file.
In a real authoring turn — spec in, model out — **reasoning is 77-93% of the
output cost**; the geometry file is around 7%. A 30-50% difference in file size
therefore moves the bill by single digits, which is why Cuboidy uses plain JSON
instead of a denser bespoke syntax.

The efficiency work that pays off is elsewhere: the voxel-row alphabet keeps a
grid at one character per cell, and `cuboidy-view` / `cuboidy-query` let a model
inspect a model without re-reading the whole file.

*(This replaced a `.cvox` text format in 2026-07, after measurement:
the size advantage was real but immaterial next to reasoning, a blind pairwise
vote over four briefs went 4-0 for JSON, and one non-Claude model could not
produce the text format at all. Four judged pairs is a small sample — it shows
the text format never demonstrated its claimed advantage, not that JSON
generates better models. Harness and raw votes are in git history, `b139ef4`.)*

## Roadmap

Done — the v0.9 spec and a complete TypeScript implementation of it
(`ts/packages/core/`, 466 tests):

- [x] Reference parser, canonical serializer (a verified byte-level fixed point
      on every shipped model), and manifest validation
- [x] Shared project loader (`resolveProject`) behind lint, the CLIs and the
      editor, so all three read a package the same way
- [x] Lint — `lintGeometry` (W01–W05, H01–H02) plus cross-file
      `validateProject` (part matching, duplicate names, palette resolution and
      range, animation targets, W06 l/r symmetry, W07 unreferenced file)
- [x] JSON Schemas for both file kinds, generated from the same Zod schemas the
      runtime uses, plus shared `fixtures/` as the cross-implementation contract
- [x] Inspection CLIs — `cuboidy-view`, `cuboidy-query`, `cuboidy-snap`

In progress and planned:

- [~] Web-based editor (`ts/packages/editor/`) — loads folders / geometry files / `.cuboidy` ZIPs; Geometry / Rig / Anim views; part, palette and keyframe-animation editing with undo/redo; direct manipulation in the 3D preview; project-aware save/export (FSA writeback or ZIP); Playwright E2E suite. Run locally with `cd ts/packages/editor && npm run dev`
- [ ] Reference parser (C#)
- [ ] Rig vocabulary docs (quadruped / biped / winged / ...)
- [ ] Packed format spec (`.cuboidy` ZIP)

## License

[MIT](LICENSE). The reference parser, examples, and specification are released
under the MIT license. Implementations in any language are encouraged.
