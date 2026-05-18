# Cuboidy Test Fixtures

Shared negative fixtures for all Cuboidy implementations (TS, C#, ...).
Each subdirectory is named after a structural diagnostic code from `SPEC.md`
§11; every file inside that subdirectory must fail with that code.

## Layout

```
fixtures/
├── README.md
├── cvox/
│   ├── missing/
│   │   ├── palette.cvox        no `palette` declaration anywhere
│   │   └── parts.cvox          palette declared but no `part`
│   ├── duplicate/
│   │   └── palette.cvox        two `palette` declarations
│   ├── invalid-value/
│   │   ├── layer-out-of-range.cvox
│   │   └── size-zero.cvox
│   └── wrong-arity/
│       ├── row-width.cvox
│       └── row-count.cvox
└── json/
    └── missing/
        ├── name.json           missing top-level `name`
        └── parts.json          missing or empty `parts`
```

Add a `// ...` comment on the first line of each cvox file documenting the
specific intent. JSON files (which have no comment syntax) document intent
through the filename alone.

## Cross-implementation parity

A new implementation passes parity testing when, for every fixture, it
returns the diagnostic code matching its enclosing subdirectory name. The
TypeScript reference impl checks this automatically via
`ts/packages/core/test/fixtures-parity.test.ts`.

## Naming convention

```
fixtures/<kind>/<code>/<descriptor>.<ext>
```

- `<kind>` = `cvox` or `json`
- `<code>` = `missing` / `duplicate` / `unknown` / `invalid-value` / `wrong-arity`
- `<descriptor>` = a short kebab-case identifier of what the file tests
- `<ext>` = `cvox` or `json`
