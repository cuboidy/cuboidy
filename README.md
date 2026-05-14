# Cubit

An open text-based file format for voxel character models, rigs, and animations.

**Status: early design, in flux. No spec doc yet — see example models for the current shape.**

## What it is

Cubit describes voxel characters as a hierarchy of rigid parts, with named attachment sockets and shareable keyframe animations. It combines ideas from several established formats:

- **Minecraft Bedrock** geometry/animation files — rigid part hierarchy, per-bone pivots
- **Mixamo** animation clips — cross-rig reusable animations bound by part name
- **MagicaVoxel** — voxel grid + inline palette
- **VRM** — named attachment points / standardized rig vocabulary (planned)

Files are JSON + plain text only. The format is designed to be:

- **Human-readable** — diff-friendly, editable in any text editor
- **AI-authorable** — structure favors generation reliability over byte efficiency
- **Browser-editable** — no proprietary binary, no native runtime dependencies
- **Self-contained** — no registry, no namespace lookups; everything resolves via filesystem

## Folder layout

A Cubit model is a **folder**, not a single file:

```
my-model/
├── cubit.json        manifest: rig hierarchy + animations (+ references)
├── voxels.cvox       voxel definition: palette + per-part grid + pivots + sockets
└── anims/            (optional) shared animations
    └── walk.json
```

For distribution, the folder can be packed into a single ZIP:

```
my-model.cubit        packed package (ZIP of the folder above)
```

| File | Role | Format | Validation |
|---|---|---|---|
| `cubit.json` | manifest (fixed name) | JSON | JSON Schema (`schema/cubit.schema.json`) |
| `voxels.cvox` | voxel definition | custom text | `cubit-lint` |
| `anims/*.json` | optional shared animations | JSON | JSON Schema (shared) |
| `*.cubit` | packed package | ZIP | both, after extraction |

## Examples

- `wolf/` — three-part rig (body / head / tail) with idle animation, sockets for `hat` and `mouth`
- `crown/` — single-part static accessory, designed to attach to wolf's `hat` socket

## Roadmap

- [ ] Spec document (`SPEC.md`)
- [ ] JSON Schema for `cubit.json` (`schema/cubit.schema.json`)
- [ ] Voxel definition linter (`cubit-lint`)
- [ ] Reference parser (C# / TypeScript)
- [ ] Web-based editor
- [ ] Rig vocabulary docs (quadruped / biped / winged / ...)
- [ ] Packed format spec (`.cubit` ZIP)

## License

TBD.
