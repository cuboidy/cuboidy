import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  STUDIO_AMBIENT,
  STUDIO_FILL,
  STUDIO_KEY,
  makeStudioEnvironment,
} from '@cuboidy/three';

// The studio rig as r3f components: the lights as children, the environment
// installed as a scene property (which is not an object, so it cannot be a
// child).
//
// Every number it uses comes from `@cuboidy/three`, which is also what the
// plain-three `addStudioLighting` installs. They were four different rigs
// once — the thumbnail carried a comment promising it was "lit the same way
// the scene view is" while running 0.75 ambient against the scene view's
// 0.12 — and one shared constant is what stops that happening again.
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
