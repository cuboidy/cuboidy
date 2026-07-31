# @cuboidy/core

Reference implementation of the [Cuboidy](../../../README.md) voxel model
format: parser, canonical serializer, manifest validation, project loader, lint
and inspection CLIs. Tracks [SPEC.md](../../../SPEC.md) v0.9.

## Install

```bash
npm install @cuboidy/core
```

## Library

```ts
import {
  parseGeometry,      // JSON value  → Geometry AST      (§7)
  parseGeometryText,  // text        → Geometry AST, with line numbers
  serializeGeometry,  // Geometry    → canonical JSON text
  parseManifest,      // JSON value  → Manifest          (§6)
  resolveProject,     // manifest + file map → the whole resolved model
  lintGeometry,       // W01–W05, H01–H02                (§11.3, §11.4)
  validateProject,    // cross-file rules                (§11.6)
} from '@cuboidy/core';
```

Readers return a `Result<T>` — `{ ok: true, value }` or `{ ok: false, code,
message, path? }`, where `code` is one of the five §11.2 structural codes.
Nothing throws on bad input.

`resolveProject` is the entry point that matters for a whole model. Given a
manifest and the package's files as a `path → text` map, it follows the
manifest's `geometry` list, resolves palette references and external animation
files, and hands back one structure plus its diagnostics. Taking a map rather
than a directory is deliberate: the same function serves the CLIs reading from
disk and the browser editor, which has no filesystem. That shared layer is what
keeps the two agreeing about what a package means.

The serializer is a byte-level fixed point — `serializeGeometry(parseGeometry(x))`
round-trips every shipped model — so it is safe to use as a formatter.

## CLIs

| Command | What it does |
|---|---|
| `cuboidy-lint <dir>` | Geometry + cross-file lint. `--strict` treats warnings as errors |
| `cuboidy-view <dir>` | Orthographic ASCII projections, for a token-cheap read |
| `cuboidy-query <dir> --at=x,y,z` | Exact voxel lookup at world coordinates |
| `cuboidy-snap <dir>` | Multi-angle PNG renders — contact sheet plus one per angle. No browser, no native bindings |
| `cuboidy-part` | `duplicate` and `mirror` part operations, the way symmetric limbs are made |

## Development

```bash
npm run build       # clean + tsc
npm test            # vitest
npm run verify      # typecheck + test
npm run generate:schema   # regenerate schema/*.json from the Zod schemas
```

The published JSON Schemas are generated from the Zod schemas rather than
hand-written, so the runtime validator and the artifact cannot drift.
`test/fixtures-parity.test.ts` checks the shared `fixtures/` corpus, which is
the cross-implementation contract — a second implementation in another language
passes parity when every fixture yields the code its directory is named after.

## License

MIT
