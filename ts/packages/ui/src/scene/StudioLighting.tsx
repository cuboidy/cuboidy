import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { AmbientLight, DirectionalLight, type Scene, type WebGLRenderer } from 'three';
import { makeStudioEnvironment } from './environment.js';

// ONE lighting rig for every surface that draws a model: the editor's scene
// view, the editor's animation viewport, the workspace's scene view, and the
// workspace's thumbnail renderer.
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

// Plain-three version, for the thumbnail renderer, which has no React root.
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

// r3f version. Renders the lights as children and installs the environment
// as a scene property (which is not an object, so it cannot be a child).
export function StudioLighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const environment = makeStudioEnvironment(gl);
    const previous = scene.environment;
    scene.environment = environment.texture;
    return () => {
      scene.environment = previous;
      environment.dispose();
    };
  }, [gl, scene]);

  return (
    <>
      <ambientLight intensity={STUDIO_AMBIENT} />
      <directionalLight
        intensity={STUDIO_KEY.intensity}
        position={STUDIO_KEY.position}
      />
      <directionalLight
        intensity={STUDIO_FILL.intensity}
        position={STUDIO_FILL.position}
      />
    </>
  );
}
