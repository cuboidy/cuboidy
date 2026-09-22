# @cuboidy/three

three.js for [Cuboidy](../../../README.md) models. Voxels to a
`BufferGeometry`, SPEC §7.4 palette materials to `MeshStandardMaterial`,
back-to-front ordering for translucent faces, the rig that places the parts,
the lighting a voxel model is meant to be seen under — and one call that
turns a whole package into a `THREE.Object3D`.

No React. The dependencies are `@cuboidy/core` and `three`, and nothing
else; `three` is a peer, so a host brings its own.

The React components that draw the same things inside a
[react-three-fiber](https://r3f.docs.pmnd.rs/) scene are
[`@cuboidy/r3f`](../r3f/README.md), which sits on top of this.

## A whole package, as one object

```ts
import { parseManifest, resolveProject, sampleAnimation } from '@cuboidy/core';
import { buildModelObject, addStudioLighting } from '@cuboidy/three';

const manifest = parseManifest(JSON.parse(text));         // §6
const project = resolveProject(manifest.value, files);    // the whole model

const model = buildModelObject({
  manifest: manifest.value,
  parts: project.parts,
});
scene.add(model.object);
const teardownLighting = addStudioLighting(scene, renderer);
```

`model.object` is a plain `Group` whose origin is the model's origin
(§6.12). Its parts are nested exactly as SPEC §6.2 says — a child rides its
parent's position and rotation, and is not scaled by it.

Three things it can then do:

```ts
// Play a clip. `poses` is core's sampled pose map; null is the rest pose.
model.setPose(sampleAnimation(clip, t));

// Hang another model on a published socket (§6.12). Returns the detach,
// or null when the host does not publish that name.
const detach = model.attach('weapon', sword.object);

// Once per frame, BEFORE renderer.render, with the camera being drawn
// from. A model with no translucent colour makes this a call that returns.
model.sortTranslucent(camera);
```

An attached guest is parented into the host's tree, not placed at a
computed world frame, so it follows the host through an animation or a drag
with no per-frame bookkeeping — and keeps its own size, because §7.8 moves
the socket with the part's scale but does not resize what hangs on it.

Call `model.dispose()` when the model leaves the scene; it frees every
geometry and material it built.

## In a browser, with no build step

`npm run build` also emits two browser bundles under `dist/browser/`.
`three` is never bundled into either: two copies of three.js in one page is
a correctness problem, not a size one — `instanceof` fails across them, and
the second copy's `Object3D` cannot be added to the first copy's scene.

**As a classic script.** `three`'s UMD build installs a global `THREE`, and
this bundle reads it and installs `CuboidyThree`:

```html
<script src="https://unpkg.com/three@0.170.0/build/three.min.js"></script>
<script src="cuboidy-three.global.js"></script>
<script>
  const model = CuboidyThree.buildModelObject({ manifest, parts });
  scene.add(model.object);
</script>
```

**As a module,** which is three.js's own recommended route and gives the
page one copy of three:

```html
<script type="importmap">
  { "imports": { "three": "https://unpkg.com/three@0.170.0/build/three.module.js" } }
</script>
<script type="module">
  import { buildModelObject } from './cuboidy-three.esm.js';
</script>
```

Both need `@cuboidy/core` to have produced the `manifest` and `parts` — a
page that loads a model from JSON wants core in it too.

## The rest of the surface

| | |
|---|---|
| `buildPartGeometry(part, palette)` | One part's voxels → a `BufferGeometry`, with the material buckets and the boundary between the depth-writing prefix and the blended remainder |
| `buildPartMaterials(materials)` | §7.4 metal/rough/emissive → `MeshStandardMaterial[]` |
| `makeTranslucentSorter(...)` | Back-to-front ordering **within** one part — three.js sorts objects, never the triangles inside one, and core's own renderer does sort |
| `buildRigTree` / `buildRigTreeOf` | The parent/child forest, cycle-safe (a malformed manifest must not hang a viewer) |
| `partPlacement(node, pose)` | SPEC §7.7 as three nested transforms. The one statement of the formula both renderers in this repository read |
| `computeSceneBounds` / `Span` / `Center` | Camera framing from the REST pose, so the camera does not jump as a clip plays |
| `addStudioLighting(scene, renderer)` | Ambient + key + fill + a prefiltered gradient environment. Without an environment, §7.4's `metallic: 1` renders as very nearly black — a metal has nothing to reflect |
| `axisCross`, `GIZMO_*`, `srgbToLinear` | Overlay drawing primitives, shared so "socket" and "selection" look the same wherever they are drawn |

## Scripts

```bash
npm run build      # tsc → dist/, then the two browser bundles
npm run bundle     # the browser bundles alone
npm run typecheck
npm test
```
