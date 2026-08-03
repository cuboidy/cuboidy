import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { Camera } from 'three';

// Hands the camera out to the DOM side, which needs it to turn a
// dragover's client coordinates into a point in the scene. Inside the
// Canvas because that is the only place r3f's context exists.
export function CaptureCamera({ into }: { into: { current: Camera | null } }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    into.current = camera;
    return () => {
      into.current = null;
    };
  }, [camera, into]);
  return null;
}

// `<Canvas camera={...}>` is read once, at mount — and at mount the scene
// is empty, so the framing was computed for nothing and never revisited.
// The first model then appeared with the camera inside it. This reframes
// when the scene's extent GROWS, which is the moment the old framing stops
// containing it; shrinking is left alone so removing one model does not
// yank the view the user has since orbited to.
export function FrameCamera({ reach }: { reach: number }) {
  const camera = useThree((s) => s.camera);
  const framed = useRef(0);
  useEffect(() => {
    if (reach <= framed.current) return;
    framed.current = reach;
    camera.position.set(reach * 1.6, reach * 1.3, reach * 1.6);
    camera.lookAt(0, reach * 0.35, 0);
    camera.updateProjectionMatrix();
  }, [reach, camera]);
  return null;
}
