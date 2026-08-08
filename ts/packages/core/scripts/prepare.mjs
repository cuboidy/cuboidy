// `prepare` runs on `npm install`, which is what makes a fresh clone able to
// typecheck the apps: they resolve `@cuboidy/core` to `./dist`, and `dist` is
// gitignored.
//
// It must not run `npm run build` directly. That is `clean && tsc`, and both
// halves misbehave here:
//
//   - `tsc` is a devDependency, so `npm ci --omit=dev` cannot run it — and
//     `clean` has already deleted `dist` by then, so a production install
//     both fails AND destroys the artifact it was installing.
//   - a type error anywhere in `src` then fails `npm install` itself, which
//     is a confusing place to learn about one.
//
// So: build only when the toolchain is actually present, and never delete
// what we cannot replace.
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(pkg, 'node_modules', '.bin', 'tsc');
const rootTsc = join(pkg, '..', '..', 'node_modules', '.bin', 'tsc');
const bin = existsSync(tsc) ? tsc : existsSync(rootTsc) ? rootTsc : null;

if (bin === null) {
  console.log('@cuboidy/core: no typescript present, keeping dist/ as shipped');
  process.exit(0);
}

rmSync(join(pkg, 'dist'), { recursive: true, force: true });
const r = spawnSync(bin, ['-p', join(pkg, 'tsconfig.json')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
// A type error is a real failure, but reporting it from `npm install` helps
// nobody — `npm run typecheck` is where it belongs. Say so and continue.
if (r.status !== 0) {
  console.error('@cuboidy/core: build failed — run `npm run typecheck` for detail');
}
process.exit(0);
