// `prepare` runs on `npm install`, which is what makes a fresh clone able to
// build the apps: they resolve `@cuboidy/three` to `./dist`, and `dist` is
// gitignored. `npm run build --workspaces` alone is not enough — npm runs the
// workspaces alphabetically, so `editor` builds before `three` does.
//
// The guards are the same ones `@cuboidy/core/scripts/prepare.mjs` documents:
// the toolchain is a devDependency, so `npm ci --omit=dev` has neither `tsc`
// nor `esbuild`, and `build` starts by deleting `dist` — a production install
// would both fail and destroy the artifact it was installing. So: build only
// when the toolchain is actually present, and never delete what we cannot
// replace.
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const local = join(pkg, 'node_modules', '.bin', 'tsc');
const hoisted = join(pkg, '..', '..', 'node_modules', '.bin', 'tsc');
const tsc = existsSync(local) ? local : existsSync(hoisted) ? hoisted : null;

const require = createRequire(import.meta.url);
let esbuild = true;
try {
  require.resolve('esbuild');
} catch {
  esbuild = false;
}

if (tsc === null || !esbuild) {
  console.log('@cuboidy/three: no build toolchain present, keeping dist/ as shipped');
  process.exit(0);
}

rmSync(join(pkg, 'dist'), { recursive: true, force: true });
const compiled = spawnSync(tsc, ['-p', join(pkg, 'tsconfig.json')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
// A type error is a real failure, but reporting it from `npm install` helps
// nobody — `npm run typecheck` is where it belongs. Say so and continue.
if (compiled.status !== 0) {
  console.error('@cuboidy/three: build failed — run `npm run typecheck` for detail');
  process.exit(0);
}

// The browser bundles read `src`, not `dist`, so they do not depend on the
// step above landing — but a bundle built from source that does not compile
// would be a lie about what the package is. Only run it when `tsc` agreed.
spawnSync(process.execPath, [join(pkg, 'scripts', 'bundle.mjs')], {
  stdio: 'inherit',
});
process.exit(0);
