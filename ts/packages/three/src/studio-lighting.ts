import { AmbientLight, DirectionalLight, type Scene, type WebGLRenderer } from 'three';
import { makeStudioEnvironment } from './environment.js';

// ONE lighting rig for every surface that draws a model: the editor's scene
// view, the editor's animation viewport, the workspace's scene view, the
// workspace's thumbnail renderer, and any page that loads the browser bundle.
//
// It is one module because the four had drifted into four different rigs.
// The thumbnail carried a comment promising it was "lit the same way the
// scene view is" while running 0.75 ambient against the scene view's 0.12,
// and the workspace scene view had no environment at all — so a `metallic`
// model looked right in the editor, right on its library card, and BLACK in
// the scene you dropped it into. A metal has no diffuse term; without
// something to reflect it renders black, and that is not a bug that argues
// with you, it just looks like a hole.

// Ambient is low BECAUSE the environment supplies diffuse fill of its own,
// and supplies more of it than a flat 0.8 ambient did. Tuned by rendering a
// plain grey block with the environment toggled and matching the exposure —
// re-measure the same way if the gradient in environment.ts changes.
export const STUDIO_AMBIENT = 0.12;
export const STUDIO_KEY = { intensity: 1.1, position: [6, 10, 8] } as const;
export const STUDIO_FILL = { intensity: 0.4, position: [-8, 4, -6] } as const;

// The rig installed on a plain three.js scene — what a caller with no React
// root uses (the thumbnail renderer, a page holding its own `WebGLRenderer`).
// `@cuboidy/r3f`'s `<StudioLighting />` is the same three values declared as
// components, and reads its numbers from here so the two cannot drift.
//
// Returns the teardown; the environment's render target leaks without it.
export function addStudioLighting(
  scene: Scene,
  renderer: WebGLRenderer,
): () => void {
  const environment = makeStudioEnvironment(renderer);
  scene.environment = environment.texture;

  const ambient = new AmbientLight(0xffffff, STUDIO_AMBIENT);
  const key = new DirectionalLight(0xffffff, STUDIO_KEY.intensity);
  key.position.set(...STUDIO_KEY.position);
  const fill = new DirectionalLight(0xffffff, STUDIO_FILL.intensity);
  fill.position.set(...STUDIO_FILL.position);
  scene.add(ambient, key, fill);

  return () => {
    scene.remove(ambient, key, fill);
    scene.environment = null;
    environment.dispose();
  };
}
