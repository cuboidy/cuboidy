# Cuboidy Test Fixtures

Shared negative fixtures for all Cuboidy implementations (TS, C#, ...).
Each subdirectory is named after a structural diagnostic code from `SPEC.md`
§11; every file inside that subdirectory must fail with that code.

Both file kinds are JSON, so a fixture only fails structurally — a malformed
*document* is the JSON parser's business and needs no shared fixture.

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
└── manifest/                          SPEC §6 — cuboidy.json
    └── missing/
        ├── name.json                  missing top-level `name`
        └── parts.json                 missing or empty `parts`
```

## Cross-implementation parity

A new implementation passes parity testing when, for every fixture, it
returns the diagnostic code matching its enclosing subdirectory name. The
TypeScript reference impl checks this automatically via
`ts/packages/core/test/fixtures-parity.test.ts`, which also fails if a code
directory is empty — so adding a directory means adding a fixture.

## Naming convention

```
fixtures/<kind>/<code>/<descriptor>.json
```

- `<kind>` = `geometry` or `manifest`
- `<code>` = `missing` / `duplicate` / `unknown` / `invalid-value` / `wrong-arity`
- `<descriptor>` = a short kebab-case identifier of what the file tests

JSON has no comment syntax, so a fixture documents its intent through the
filename and the table above.
