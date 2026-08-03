import { buildLibrary, type Library } from '../src/lib/library.js';

// The shared cast: a host that publishes one socket, and a one-voxel
// guest that publishes nothing. Three suites (scene / placement / drop)
// used to carry verbatim copies of these.

// A 1×2×1 tower whose `top` socket is published as `peg`. `socketRot`
// turns the socket — the placement tests need a genuinely rotated frame,
// not a translated copy of the world's.
export function towerJson(
  opts: { name?: string; socketRot?: [number, number, number] } = {},
): string {
  const { name = 'tower', socketRot } = opts;
  return JSON.stringify({
    name,
    parts: [
      {
        name: 'body',
        geometry: {
          size: [1, 2, 1],
          pivot: { pos: [0, 0, 0] },
          sockets: [
            {
              name: 'top',
              pos: [0, 2, 0],
              ...(socketRot !== undefined && { rot: socketRot }),
            },
          ],
          voxels: [['0'], ['0']],
        },
      },
    ],
    palette: ['#FF0000'],
    sockets: { peg: { part: 'body', socket: 'top' } },
  });
}

export const GEM_JSON = JSON.stringify({
  name: 'gem',
  palette: ['#00FF00'],
  parts: [{ name: 'gem', geometry: { size: [1, 1, 1], voxels: [['0']] } }],
});

export function towerAndGemLibrary(
  opts: { socketRot?: [number, number, number] } = {},
): Library {
  return buildLibrary(
    'lib',
    new Map([
      ['tower/cuboidy.json', towerJson(opts)],
      ['gem/cuboidy.json', GEM_JSON],
    ]),
  );
}
