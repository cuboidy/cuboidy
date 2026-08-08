import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Color } from 'three';

// What a model is seen against, in every 3D viewport.
//
// There were three answers and none of them agreed. The editor's canvas was
// transparent, so the viewport showed whatever was behind it — `.dock-leaf`,
// i.e. `--bg-1`, the PANEL BODY colour, which made the 3D area the same
// shade as the chrome around it. The workspace set `#14161a` inline, a
// fourth value matching no token at all. And `--bg-0` has said "deepest:
// app ground / 3D canvas / inputs' backdrop" the whole time, so the design
// system already had an answer neither viewport was using.
//
// Read from the token rather than copied into TypeScript. A hex literal here
// would be a fifth value the moment anyone touched tokens.css, and this file
// exists because there were already four.
const TOKEN = '--bg-0';
// Only if the stylesheet has not loaded — `--bg-0`'s current value, so a
// miss looks like the intended colour rather than like a bug.
const FALLBACK = '#0e1116';

export function studioBackgroundColor(): string {
  if (typeof document === 'undefined') return FALLBACK;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(TOKEN)
    .trim();
  return v === '' ? FALLBACK : v;
}

export function StudioBackground() {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const previous = scene.background;
    const color = new Color(studioBackgroundColor());
    scene.background = color;
    return () => {
      scene.background = previous;
    };
  }, [scene]);

  return null;
}
