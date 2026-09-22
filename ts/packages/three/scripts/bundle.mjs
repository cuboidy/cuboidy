// The browser bundle: this package on a page that has no build step.
//
// The case is a page that loads three.js from a CDN and wants to show a
// Cuboidy model — a model browser, an item page, a bug report with the
// model in it. Everything else in this repository is consumed as TypeScript
// source by a bundler, which is fine for the two apps and useless to a
// single HTML file.
//
// Two outputs, because there are two ways such a page gets its three.js:
//
//   cuboidy-three.global.js  A classic <script>. `three` is taken from the
//                            global `THREE`, which is what the UMD build on
//                            a CDN installs, and this package lands on
//                            `window.CuboidyThree`.
//
//   cuboidy-three.esm.js     A <script type="module">. `three` is left as a
//                            bare import for an import map or a bundler to
//                            resolve — three.js's own recommended route,
//                            and the one that gives a page ONE copy of
//                            three rather than a second bundled inside
//                            this one.
//
// `three` is never bundled either way. Two copies of three.js in one page
// is not a size problem, it is a correctness one: `instanceof` fails across
// them and the second copy's `Object3D` cannot be added to the first's
// scene.
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(pkg, 'dist', 'browser');
// `browser.ts`, not `index.ts`: the bundle carries @cuboidy/core out with
// it, because a page with no build step has no other way to get one.
const entry = join(pkg, 'src', 'browser.ts');
mkdirSync(outDir, { recursive: true });

// For the IIFE build, `three` is not external in esbuild's sense — an IIFE
// has no loader to resolve an external with. It is redirected to a one-line
// module that reads the global the CDN script installed.
const threeFromGlobal = {
  name: 'three-from-global',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({
      path: 'three',
      namespace: 'three-global',
    }));
    b.onLoad({ filter: /.*/, namespace: 'three-global' }, () => ({
      contents: [
        'const THREE = globalThis.THREE;',
        'if (THREE === undefined) {',
        "  throw new Error('[cuboidy] three.js must be loaded before this script: window.THREE is undefined');",
        '}',
        'module.exports = THREE;',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const common = {
  entryPoints: [entry],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2022'],
  logLevel: 'info',
};

await build({
  ...common,
  format: 'iife',
  globalName: 'CuboidyThree',
  plugins: [threeFromGlobal],
  outfile: join(outDir, 'cuboidy-three.global.js'),
});

await build({
  ...common,
  format: 'esm',
  external: ['three'],
  outfile: join(outDir, 'cuboidy-three.esm.js'),
});

for (const name of ['cuboidy-three.global.js', 'cuboidy-three.esm.js']) {
  const { size } = statSync(join(outDir, name));
  console.log(`${name}  ${(size / 1024).toFixed(1)} kB`);
}
