# @cuboidy/core

Reference implementation of the
[Cuboidy](https://github.com/cuboidy/cuboidy) voxel model format: parser,
canonical serializer, manifest validation, project loader, lint and inspection
CLIs. Tracks
[SPEC.md](https://github.com/cuboidy/cuboidy/blob/main/SPEC.md) v0.9 — the
package version tracks the spec version it implements.

Cuboidy describes voxel characters as a hierarchy of rigid parts, with named
attachment sockets and shareable keyframe animations, entirely in JSON. This
package is the layer every other one reads a package through: it has no DOM
and no renderer in it. To draw a model, add
[`@cuboidy/three`](https://www.npmjs.com/package/@cuboidy/three).

## Install

```bash
npm install @cuboidy/core
```

The eight CLIs come with it, so `npx cuboidy-lint <dir>` works without a
project install.

## From a CDN

There is no standalone browser build of this package. `@cuboidy/three`'s
browser bundles carry core out with them — a page with no build step gets the
parser and the renderer in one file:

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@cuboidy/three@0.9.0/dist/browser/cuboidy-three.global.js"></script>
<script>
  const manifest = CuboidyThree.parseManifest(JSON.parse(text));
</script>
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
| `cuboidy-gif <dir>` | Animated GIF of a clip, or `--orbit` for a turntable |
| `cuboidy-part` | `duplicate` and `mirror` part operations, the way symmetric limbs are made |
| `cuboidy-overlap <dir>` | Voxels two parts both occupy, per pair, in the rest pose |
| `cuboidy-clash <dir>` | The same over a clip — a part that passes *through* another while moving |

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

[MIT](LICENSE).
