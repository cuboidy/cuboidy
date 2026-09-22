import { useEffect, useMemo } from 'react';
import { GridHelper } from 'three';
import { studioGridSpec } from '@cuboidy/three';

// The ground plane. What size it should be is `@cuboidy/three`'s
// `studioGridSpec`; this is the helper built from it and freed with it.

interface Props {
  // World bounds of whatever is being shown. Absent → the floor size.
  min?: readonly [number, number, number] | undefined;
  max?: readonly [number, number, number] | undefined;
  visible?: boolean;
}

export function StudioGrid({ min, max, visible = true }: Props) {
  // Keyed on the SPEC, not on the bounds object: a re-render that produces
  // the same size and step must not rebuild the helper, and callers pass
  // fresh arrays every render.
  const spec = studioGridSpec(min ?? [0, 0, 0], max ?? [0, 0, 0]);
  const grid = useMemo(
    () =>
      // The two lines through the origin are brighter: with the grid centred
      // there IS an origin to point at, and it is the coordinate every
      // pivot, socket and manifest position is stated against.
      new GridHelper(spec.size, spec.divisions, 0x4a5160, 0x2a2f38),
    [spec.size, spec.divisions],
  );
  useEffect(() => {
    return () => {
      grid.geometry.dispose();
      for (const m of Array.isArray(grid.material)
        ? grid.material
        : [grid.material]) {
        m.dispose();
      }
    };
  }, [grid]);

  // `visible` rather than unmounting, so toggling the grid off and on does
  // not rebuild it.
  return <primitive object={grid} visible={visible} />;
}
