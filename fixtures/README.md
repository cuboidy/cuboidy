# Cuboidy Test Fixtures

Shared negative fixtures for all Cuboidy implementations (TS, C#, ...).
Each file targets one diagnostic ID from `SPEC.md` §11.

## Naming convention

```
<SPEC-ID>-<short-kebab-desc>.<ext>
```

Examples:
- `json/C01-missing-name.json` — missing top-level `name` field
- `cvox/E08-row-width.cvox` — voxel row width does not match declared `W`

Positive fixtures live at the repo root: `wolf/`, `crown/`.

## Layout

```
fixtures/
├── README.md
├── json/        cuboidy.json negative cases (Cxx, Xxx)
└── cvox/        voxels.cvox negative cases (Exx, Wxx)
```

Each invalid fixture must fail with exactly the diagnostic ID in its filename.
For cvox cases, the intent is documented as a `// ...` comment on the first
line of the file. For JSON cases (which have no comment syntax) the filename
itself documents the intent — no inline note is added because the manifest
parser runs in strict mode (unknown fields are C13).

## Cross-implementation parity

These fixtures are the canonical contract for behavioral parity across
implementations (TypeScript, C#, ...). A new implementation passes parity
testing when, for every fixture, it reports the diagnostic code encoded in
the filename.
