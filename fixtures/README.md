# Cuboidy Test Fixtures

Shared negative fixtures for all Cuboidy implementations (TS, C#, ...).
Each subdirectory is named after a structural diagnostic code from `SPEC.md`
§11; every file inside that subdirectory must fail with that code.

Every file kind is JSON, so a fixture only fails structurally — a malformed
*document* is the JSON parser's business and needs no shared fixture. Each
fixture holds exactly ONE error, which is what lets parity compare by code
without depending on §11.8's within-phase ordering.

## Layout

```
fixtures/
├── README.md
├── geometry/                          SPEC §7 — a geometry file
│   ├── missing/
│   │   ├── parts.json                 no `parts` key
│   │   ├── parts-empty.json           `parts` present but empty
│   │   ├── size.json                  part has voxels but no `size`
│   │   └── voxels.json                part has size but no `voxels`
│   ├── duplicate/
│   │   ├── part-name.json             two parts share a name
│   │   └── socket-name.json           two sockets in one part share a name
│   ├── unknown/
│   │   ├── unknown-field.json         unrecognised top-level key
│   │   └── unknown-part-field.json    unrecognised key on a part
│   ├── invalid-value/
│   │   ├── bad-voxel-char.json        voxel cell outside [.0-9a-zA-Z]
│   │   ├── bad-color.json             palette entry is not #RGB/#RGBA/#RRGGBB/#RRGGBBAA
│   │   ├── bad-part-name.json         part name fails the §5 identifier rule
│   │   ├── palette-index.json         cell indexes past the declared palette
│   │   └── size-zero.json             size dimension 0 is below the minimum
│   └── wrong-arity/
│       ├── row-width.json             row length does not match W
│       ├── row-count.json             rows in a layer do not match D
│       ├── layer-count.json           layer count does not match H
│       └── size-arity.json            `size` is not a triple
├── manifest/                          SPEC §6 — cuboidy.json
│   ├── missing/
│   │   ├── name.json                  missing top-level `name`
│   │   ├── parts.json                 missing or empty `parts`
│   │   ├── part-name.json             a part with no `name`
│   │   ├── inline-size.json           §6.13 inline geometry with no `size`
│   │   └── anim-loop.json             §6.4 clip with no `loop`
│   ├── duplicate/
│   │   ├── part-name.json             two parts share a name
│   │   └── socket-name.json           two sockets in one inline part share a name
│   ├── unknown/
│   │   ├── unknown-field.json         unrecognised top-level key
│   │   ├── unknown-part-field.json    unrecognised key on a part
│   │   └── ease-preset.json           §6.5 ease naming no preset
│   ├── invalid-value/
│   │   ├── bad-model-name.json        model name fails the §5 identifier rule
│   │   ├── dangling-parent.json       `parent` names no part (§11.5)
│   │   ├── parent-cycle.json          a parent chain closes on itself (§11.5)
│   │   └── absolute-ref.json          a §8 reference path that is absolute
│   └── wrong-arity/
│       ├── position-arity.json        `position` is not a triple
│       ├── palette-empty.json         inline palette with no colors
│       └── inline-row-width.json      §6.13 row length does not match W
└── palette/                           SPEC §6.10 — an external palette file
    ├── missing/
    │   └── colors.json                no `colors` key
    ├── unknown/
    │   └── unknown-field.json         unrecognised top-level key
    ├── invalid-value/
    │   └── bad-color.json             a `colors` entry is not a hex color
    └── wrong-arity/
        └── colors-empty.json          `colors` present but empty
```

## Cross-implementation parity

A new implementation passes parity testing when, for every fixture, it
returns the diagnostic code matching its enclosing subdirectory name. The
TypeScript reference impl checks this automatically via
`ts/packages/core/test/fixtures-parity.test.ts`.

That test **discovers** the kinds from this directory rather than listing
them, and fails if a kind has no reader wired up — so adding a directory here
forces a decision on the TypeScript side rather than being silently skipped.
It also fails if a code directory is empty, so adding a directory means
adding a fixture.

## Naming convention

```
fixtures/<kind>/<code>/<descriptor>.json
```

- `<kind>` = `geometry` / `manifest` / `palette`
- `<code>` = `missing` / `duplicate` / `unknown` / `invalid-value` / `wrong-arity`
- `<descriptor>` = a short kebab-case identifier of what the file tests

JSON has no comment syntax, so a fixture documents its intent through the
filename and the table above.
