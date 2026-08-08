import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

// A metal reflects its surroundings and has no diffuse term at all. In a
// scene lit only by ambient + directional lights — which is what both
// viewports had — `metalness: 1` therefore renders as very nearly BLACK.
// Not a bug in the material: there is simply nothing to reflect. But it
// makes SPEC §7.4's `metallic` useless in practice, since the honest
// rendering of it is an unreadable silhouette.
//
// So the scene gets an environment. Not an HDRI download (an editor that
// needs the network to draw a model is not an editor) and not three's
// RoomEnvironment (a photographed room behind a voxel model reads as a
// mistake) — a plain gradient box, prefiltered here.
//
// It is deliberately low-frequency. The point is that a polished face picks
// up a gradient across it and reads as metal; anything busier would show
// recognisable shapes in the reflection of a model that has no surroundings.
//
// Built with `fromScene` rather than `fromEquirectangular`. An equirect
// DataTexture is the more obvious route and it produced a uniformly black
// PMREM here — with the envmap branch correctly compiled into the shader,
// which makes the failure look exactly like "the environment was never
// installed". `fromScene` renders real geometry through the same pipeline
// the rest of the app uses, and has no texture-upload or colour-space step
// to get wrong.

// Linear sRGB. Brighter than the viewport background on purpose: a
// mirror-smooth face shows this almost undimmed, and anything darker leaves
// `metallic: 1` looking like a hole cut in the scene.
const TOP: [number, number, number] = [1.0, 1.0, 1.0];
const MIDDLE: [number, number, number] = [0.55, 0.58, 0.65];
const BOTTOM: [number, number, number] = [0.12, 0.13, 0.15];

function stopAt(t: number): [number, number, number] {
  const [a, b] = t < 0.5 ? [BOTTOM, MIDDLE] : [MIDDLE, TOP];
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

// An inside-out box, vertex-coloured by height. Segmented so the gradient
// is smooth rather than four corner stops interpolated across a whole face.
function gradientBox(): Mesh {
  const size = 10;
  const geometry = new BoxGeometry(size, size, size, 1, 12, 1);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const [r, g, b] = stopAt(position.getY(i) / size + 0.5);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return new Mesh(
    geometry,
    // BackSide so the camera inside the box sees its walls.
    new MeshBasicMaterial({ side: BackSide, vertexColors: true }),
  );
}

// Prefiltered radiance for `scene.environment`. The caller owns the result
// and must dispose it; everything built here is cleaned up before returning.
export function makeStudioEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const box = gradientBox();
  scene.add(box);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene);

  box.geometry.dispose();
  (box.material as MeshBasicMaterial).dispose();
  pmrem.dispose();
  return target.texture;
}
