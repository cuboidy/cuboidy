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
│   │   ├── voxels.json                part has size but no `voxels`
│   │   ├── palette-entry-color.json   a §7.4 object entry omits `color`
│   │   └── regions-cells.json         a §7.13 region grid with keys and no
│   │                                  `cells`
│   ├── duplicate/
│   │   ├── part-name.json             two parts share a name
│   │   └── socket-name.json           two sockets in one part share a name
│   ├── unknown/
│   │   ├── unknown-field.json         unrecognised top-level key
│   │   ├── unknown-part-field.json    unrecognised key on a part
│   │   ├── palette-entry-key.json     unrecognised key on a §7.4 entry
│   │   └── regions-grid-field.json    a §7.13 region grid with a field other
│   │                                  than `keys` and `cells`
│   ├── invalid-value/
│   │   ├── bad-voxel-char.json        voxel cell outside [.0-9a-zA-Z$%]
│   │   ├── bad-color.json             palette entry is not #RGB/#RGBA/#RRGGBB/#RRGGBBAA
│   │   ├── bad-part-name.json         part name fails the §5 identifier rule
│   │   ├── palette-index.json         cell indexes past the declared palette
│   │   ├── size-zero.json             size dimension 0 is below the minimum
│   │   ├── material-out-of-range.json a §7.4 material field outside 0..1
│   │   ├── regions-name.json          a §7.13 region name that fails §5
│   │   ├── regions-key.json           a §7.13 key of two characters — a key
│   │   │                              is one character of a voxel row
│   │   └── regions-undeclared-key.json
│   │                                  a §7.13 grid cell holding a character
│   │                                  its keys do not declare (phase 3)
│   └── wrong-arity/
│       ├── row-width.json             row length does not match W
│       ├── row-count.json             rows in a layer do not match D
│       ├── layer-count.json           layer count does not match H
│       ├── size-arity.json            `size` is not a triple
│       ├── regions-keys-empty.json    a §7.13 region grid declaring no key
│       └── regions-row-width.json     a §7.13 grid row whose length is not W:
│                                      the grid has the shape of `voxels`
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
│   │   ├── inline-stray-part.json     §6.13 inline geometry carrying `part`,
│   │   │                              which names a part inside a REFERENCED
│   │   │                              file and has no meaning without `path`
│   │   ├── ease-preset.json           §6.5 ease naming no preset
│   │   ├── open-boundary-face.json    §6.14 `openBoundaries` naming no plane
│   │   │                              (a name outside a closed set, §11.2)
│   │   └── reference-regions.json     §7.13 `regions` on a §6.13 reference:
│   │                                  regions belong to the shape, and a
│   │                                  reference holds only where it is
│   ├── invalid-value/
│   │   ├── bad-model-name.json        model name fails the §5 identifier rule
│   │   ├── dangling-parent.json       `parent` names no part (§11.5)
│   │   ├── parent-cycle.json          a parent chain closes on itself (§11.5)
│   │   ├── anim-part-key.json         a clip's `parts` key fails §5 (the map
│   │   │                              is keyed by PART name)
│   │   ├── geometry-list-empty.json   `geometry` present but empty (§11.5 —
│   │   │                              the named exception to the container
│   │   │                              rule, which would say `wrong-arity`)
│   │   ├── absolute-ref.json          a §8 reference path that is absolute
│   │   ├── scale-zero.json            a §6.2 `scale` factor of 0, which
│   │   │                              collapses the part
│   │   ├── scale-negative.json        a §6.2 `scale` factor below 0, which
│   │   │                              mirrors the part and so reverses its
│   │   │                              face winding
│   │   ├── open-boundary-duplicate.json
│   │   │                              §6.14 the same plane twice, which says
│   │   │                              nothing the single entry does not
│   │   ├── description-line-break.json
│   │   │                              §6.15 a description that is two lines
│   │   └── description-half-surrogate.json
│   │                                  §6.15 a description ending in `\ud83d`,
│   │                                  half of a surrogate pair — not a
│   │                                  character, and a reader over
│   │                                  System.Text.Json cannot even read it
│   │                                  as a string
│   └── wrong-arity/
│       ├── position-arity.json        `position` is not a triple
│       ├── scale-arity.json           `scale` is not a triple — its own
│       │                              reader bounds each factor, and the
│       │                              bound must not swallow the arity
│       ├── palette-empty.json         inline palette with no colors
│       ├── inline-row-width.json      §6.13 row length does not match W
│       ├── inline-regions-layer-count.json
│       │                              §7.13 an inline part's region grid with
│       │                              fewer layers than H
│       ├── description-empty.json     §6.15 a description of no characters
│       └── description-too-long.json  §6.15 201 code points, one of them a
│                                      combining acute written `\u0301` —
│                                      200 characters to a reader that
│                                      composes them (NFC) or counts
│                                      graphemes, which §6.15 does not
└── palette/                           SPEC §6.10 — an external palette file
    ├── missing/
    │   ├── colors.json                no `colors` key
    │   └── entry-color.json           an object entry omits `color` (§7.4)
    ├── unknown/
    │   ├── unknown-field.json         unrecognised top-level key
    │   └── entry-key.json             unrecognised key on an entry (§7.4)
    ├── invalid-value/
    │   ├── bad-color.json             a `colors` entry is not a hex color
    │   └── material-out-of-range.json a material field outside 0..1 (§7.4)
    └── wrong-arity/
        └── colors-empty.json          `colors` present but empty
└── project/                           SPEC §11.6 — a manifest AND its files
    ├── duplicate/
    │   └── part-in-two-files/         two listed geometry files define one
    │                                  part name, so the by-`name` lookup has
    │                                  no answer and the part binds to nothing
    └── missing/
        └── part-in-no-file/           a manifest part that no listed file
                                       defines
```

### `project/` fixtures are packages, not documents

§11.6 is about a manifest and the files it references *together*, so a single
document cannot express it. Each `project/` fixture is a DIRECTORY holding a
`cuboidy.json` and whatever it names. The manifest itself always parses — the
failure is in the project, not in the document.

They are checked twice, because §11.6 splits in two:

- **Resolution.** The package must not resolve: every manifest part bound to
  a shape, no ambiguous name. In the reference that is
  `resolveProject(...).resolved === false`.

  For `duplicate/` this is normative — §11.6 says resolution itself fails,
  and **a second implementation must reproduce it whether or not it lints**,
  because a runtime that binds one of two candidate shapes makes the answer a
  fact about its hash table rather than about the model.

  For `missing/` the spec asks only that the condition be reported, so a
  library MAY hand back the parts it did resolve. The reference reports it
  through the same flag anyway: a consumer asking "can I draw this" wants one
  answer, and a flag costs nothing where a refusal would cost the editor its
  ability to show a half-finished model.
- **Reporting.** Some cross-file finding carries the code the directory
  names. That is lint, and an implementation that only draws is conforming
  without it.

Checking only the second would let a port pass §11.6 by doing nothing at all,
since it is not required to lint.

They are also the one place the "exactly ONE error" rule above does not hold,
and cannot: a name defined twice leaves the part unbound, so the `duplicate`
finding necessarily arrives with a `missing` one behind it and an `unknown`
for each now-unused definition. The directory names the CAUSE, and the check
is that the named code is among the findings — not that it is the only one.

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
