import { useCallback, useEffect, useRef, useState } from 'react';

export interface SceneClock {
  time: number;
  seek: (time: number) => void;
}

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
export function useSceneClock(running: boolean): SceneClock {
  const [time, setTime] = useState(0);
  // The last value the loop produced, kept in a ref so resuming can pick
  // up from it without the effect depending on the state it sets.
  const latest = useRef(0);
  // Wall-clock origin, re-anchored on resume and on seek, so a pause does
  // not fast-forward by however long it lasted.
  const origin = useRef(0);

  const seek = useCallback((t: number) => {
    latest.current = t;
    origin.current = performance.now() - t * 1000;
    setTime(t);
  }, []);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    origin.current = performance.now() - latest.current * 1000;
    const tick = (now: number): void => {
      const t = (now - origin.current) / 1000;
      latest.current = t;
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return { time, seek };
}
