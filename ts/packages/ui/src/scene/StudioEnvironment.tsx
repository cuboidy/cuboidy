import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { makeStudioEnvironment } from './environment.js';

// Installs the §7.4 reflection environment on the r3f scene. Renders
// nothing — `scene.environment` is a property, not an object — so it can sit
// anywhere inside a <Canvas>.
//
// Drop it and every `metallic` surface goes black. See environment.ts.
export function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const environment = makeStudioEnvironment(gl);
    const previous = scene.environment;
    scene.environment = environment;
    return () => {
      scene.environment = previous;
      environment.dispose();
    };
  }, [gl, scene]);

  return null;
}
