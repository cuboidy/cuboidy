import { useEffect, useMemo } from 'react';
import { GridHelper } from 'three';

// The ground plane, shared by the editor's two viewports and the
// workspace's scene view — which had three grids with three different sizes
// and one real bug between them.
//
// The editor's was `<gridHelper args={[n, n]} position={[n/2, 0, n/2]} />`,
// which puts the WHOLE plane in the +X +Z quadrant. Rig positions are
// signed, so a model that reaches into negative X or Z hangs off the edge
// over nothing: models/submersible spans X −10..9 and Z −15..14 and more of
// it was off the grid than on it. Worse, `n` came from the largest single
// PART's own width/depth rather than from the assembled model's bounds, so
// no amount of model could grow it past the floor of 20.
//
// Centred on the origin instead, and sized from the world bounds.

// Cell sizes worth landing on. A grid is a ruler: its lines should fall on
// coordinates a person would name, so the step walks 1, 2, 5 per decade
// rather than dividing the extent into a fixed count and producing lines at
// 3.7 apart.
const NICE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

// Above this the cells stop being countable and the grid reads as a texture
// rather than a scale. Chosen by looking: at 38 across a viewport it is
// already a wash. It also sets where the step coarsens — a voxel is the
// natural unit here, so 1 unit per cell holds until a model reaches about
// eleven units from the origin, then 2, then 5.
const MAX_DIVISIONS = 28;

export interface StudioGridSpec {
  size: number;
  divisions: number;
  step: number;
}

// Grid geometry for a model occupying `min`..`max` in world space.
//
// Symmetric about the origin: the half-extent is the furthest the model
// reaches in ANY direction along X or Z, so the origin is always on the grid
// and always at its centre. That is what makes the highlighted centre lines
// mean something — they are the axes, not an arbitrary seam.
export function studioGridSpec(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): StudioGridSpec {
  const reach = Math.max(
    Math.abs(min[0]),
    Math.abs(max[0]),
    Math.abs(min[2]),
    Math.abs(max[2]),
    // A floor, so an empty or tiny model still gets a plane to sit on
    // rather than a speck.
    6,
  );
  // Margin so the model does not sit flush to the edge.
  const target = reach * 2 * 1.25;
  const step =
    NICE_STEPS.find((s) => target / s <= MAX_DIVISIONS) ??
    NICE_STEPS[NICE_STEPS.length - 1]!;
  // Round the extent UP to a whole number of cells, and keep it even so the
  // centre falls on a line rather than inside a cell.
  let divisions = Math.ceil(target / step);
  if (divisions % 2 === 1) divisions += 1;
  return { size: divisions * step, divisions, step };
}

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
