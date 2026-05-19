# Cuboidy

An open text-based file format for voxel character models, rigs, and animations.

**Status: v0.5 draft. See [SPEC.md](SPEC.md) for the formal specification.**

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

- `wolf/` — three-part rig (body / head / tail) with idle animation, sockets for `hat` and `mouth`
- `crown/` — single-part static accessory, designed to attach to wolf's `hat` socket

## Roadmap

- [x] Spec document (`SPEC.md`) — v0.5 draft
- [x] Reference parser (TypeScript) — `ts/packages/core/`, full v0.5 grammar (131 tests)
- [x] Cross-file lint — `missing` error / `unknown` warning between manifest and voxels
- [x] Shared parity fixtures — `fixtures/cvox/<code>/` and `fixtures/json/<code>/`, contract for cross-implementation conformance
- [ ] JSON Schema for `cuboidy.json` (`schema/cuboidy.schema.json`)
- [ ] Canonical serializer (reader-tolerant / writer-strict, comment-preserving round-trip)
- [ ] Voxel definition linter (`cuboidy-lint`) — warnings (W01–W05) and hints (H01–H02)
- [ ] Reference parser (C#)
- [ ] Web-based editor (`ts/packages/web/`)
- [ ] Rig vocabulary docs (quadruped / biped / winged / ...)
- [ ] Packed format spec (`.cuboidy` ZIP)

## License

[MIT](LICENSE). The reference parser, examples, and specification are released
under the MIT license. Implementations in any language are encouraged.
