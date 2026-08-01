import { useEffect, useRef, useState } from 'react';

// One clock for the whole scene.
//
// Per-instance clocks would let two actors playing the same clip drift
// apart by however long apart they were started, which is wrong for the
// thing a scene is for — several models moving together. A shared clock
// means "both playing `walk`" looks like both walking, not like two
// people who happened to start walking at different moments.
//
// It only runs while something is playing: a still scene schedules no
// frames at all.
export function useSceneClock(running: boolean): number {
  const [time, setTime] = useState(0);
  // Wall-clock origin, adjusted on resume so pausing does not fast-forward
  // by however long the pause lasted.
  const origin = useRef(0);
  const held = useRef(0);

  useEffect(() => {
    if (!running) {
      held.current = time;
      return;
    }
    let raf = 0;
    origin.current = performance.now() - held.current * 1000;
    const tick = (now: number): void => {
      setTime((now - origin.current) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `time` is deliberately not a dependency: reading it here is how the
    // pause point is captured, and depending on it would restart the loop
    // every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return time;
}
