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

Each invalid fixture should fail with exactly the diagnostic ID in its filename.
Add an inline comment in JSON (via a `"__note"` field that the parser ignores)
or via a sidecar `.expected.txt` for cvox files when the failure intent is non-obvious.
