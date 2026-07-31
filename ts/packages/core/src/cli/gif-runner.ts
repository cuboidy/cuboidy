import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Angle } from '../render/camera.js';
import { ANGLES } from '../render/camera.js';
import { buildSceneFromParts, type OrientedPart, type Scene } from '../render/scene.js';
import { computeGlobalScale, renderTile } from '../render/snapshot.js';
import { encodeGif } from '../render/gif.js';
import { sampleAnimation } from '../animation.js';
import {
  computeWorldTransforms,
  type AnimPose,
  type Vec3Tuple,
} from '../rig-transform.js';
import { loadAndAssemble, type Assembly } from './assemble.js';
import type { Rgb } from '../render/framebuffer.js';

// cuboidy-gif: render an animation clip to an animated GIF.
//
// This closes the loop the authoring guide is built on. cuboidy-snap
// shows the rest pose, so until now the moving half of the format could
// not be looked at — every author of the shipped models wrote their own
// throwaway pose-baker to see their own work, and two of them shipped a
// first pass with the feet through the floor because a still cannot show
// that. GIF specifically, because it plays inline in a README.
//
// The camera is computed ONCE from the union of every frame's bounds and
// reused for all of them. Per-frame auto-framing — which is what you get
// by snapping baked poses one at a time — rescales the model on every
// frame and turns a walk cycle into a pulsing blob.

export interface GifOptions {
  angle: Angle;
  size: number;
  ss: number;
  fps: number;
  /** Frame count. Absent → derived from `fps` and the clip's duration. */
  frames?: number | undefined;
  bg: Rgb;
  clip?: string | undefined;
  outFile?: string | undefined;
}

export interface GifRunResult {
  exitCode: 0 | 1 | 2;
  text: string;
  gif?: Buffer;
  outPath?: string;
}

export const DEFAULT_BG: Rgb = [0.42, 0.44, 0.47];

export function renderGif(
  asm: Assembly,
  clipName: string,
  opts: GifOptions,
): { gif: Buffer; frames: number; duration: number } {
  const anim = asm.animations.get(clipName);
  if (anim === undefined) throw new Error(`unknown clip '${clipName}'`);

  // Geometry-side pivot rotations, rebuilt from the resolved parts so
  // the animated transform chain sees exactly what the rest one does.
  const pivotRots = new Map<string, Vec3Tuple>();
  for (const rp of asm.resolvedParts) {
    const rot = rp.part.pivot.rot;
    if (rot !== undefined) pivotRots.set(rp.name, [rot.x, rot.y, rot.z]);
  }

  const frameCount = Math.max(
    2,
    opts.frames ?? Math.round(anim.duration * opts.fps),
  );

  // Pass 1: build every frame's scene, and union their bounds.
  const scenes: Scene[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < frameCount; i++) {
    // Sample over [0, duration): the frame AT duration is the frame at 0
    // (§6.7), so including both ends would hold the first pose twice.
    const t = (i / frameCount) * anim.duration;
    const poses = sampleAnimation(anim, t);

    const animPoses = new Map<string, AnimPose>();
    for (const [name, p] of poses) animPoses.set(name, { rot: p.rot, pos: p.pos });
    const transforms = computeWorldTransforms(
      asm.manifest.parts,
      pivotRots,
      animPoses,
    );

    const oriented: OrientedPart[] = [];
    for (const rp of asm.resolvedParts) {
      const pose = poses.get(rp.name);
      // §6.5 `visible: false` removes the part from the frame entirely.
      if (pose !== undefined && !pose.visible) continue;
      oriented.push({
        part: rp.part,
        remap: rp.remap,
        transform: transforms.get(rp.name) ?? rp.transform,
        scale: pose?.scale,
      });
    }

    const scene = buildSceneFromParts(oriented, asm.palette);
    scenes.push(scene);
    minX = Math.min(minX, scene.min[0]); maxX = Math.max(maxX, scene.max[0]);
    minY = Math.min(minY, scene.min[1]); maxY = Math.max(maxY, scene.max[1]);
    minZ = Math.min(minZ, scene.min[2]); maxZ = Math.max(maxZ, scene.max[2]);
  }

  // One camera for the whole clip, from the union extent.
  const union: Scene = {
    quads: [],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
  const renderOpts = {
    tileSize: opts.size,
    ss: opts.ss,
    bg: opts.bg,
    overlay: false,
  };
  const scale = computeGlobalScale(union, [opts.angle], renderOpts);

  // Pass 2: render each frame against that fixed camera.
  const frames = scenes.map((s) => ({
    rgba: renderTile(
      { ...s, center: union.center, min: union.min, max: union.max },
      opts.angle,
      scale,
      renderOpts,
    ).toRgba(),
  }));

  // GIF delays are hundredths of a second and integral, so the achieved
  // rate is quantised. 10 cs (10 fps) and 5 cs (20 fps) land exactly.
  const delayCs = Math.max(2, Math.round(100 / opts.fps));
  const gif = encodeGif(frames, {
    width: opts.size,
    height: opts.size,
    delayCs,
  });
  return { gif, frames: frameCount, duration: anim.duration };
}

export async function runGif(
  dir: string,
  opts: GifOptions,
): Promise<GifRunResult> {
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return { exitCode: loaded.exitCode, text: `cuboidy-gif: ${loaded.message}` };
  }
  const asm = loaded.assembly;

  const names = [...asm.animations.keys()];
  if (names.length === 0) {
    return {
      exitCode: 1,
      text: `cuboidy-gif: ${asm.manifest.name} defines no animations`,
    };
  }
  const clip = opts.clip ?? names[0]!;
  if (!asm.animations.has(clip)) {
    return {
      exitCode: 1,
      text:
        `cuboidy-gif: unknown clip '${clip}' — ` +
        `${asm.manifest.name} has ${names.map((n) => `'${n}'`).join(', ')}`,
    };
  }

  const { gif, frames, duration } = renderGif(asm, clip, opts);
  const outPath =
    opts.outFile ?? join(resolve(dir), `${asm.manifest.name}-${clip}.gif`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, gif);

  const kb = (gif.length / 1024).toFixed(1);
  return {
    exitCode: 0,
    gif,
    outPath,
    text:
      `model: ${asm.manifest.name}  clip: ${clip} (${duration}s, ${frames} frames, ` +
      `${opts.angle.label})\nwrote ${outPath} (${kb} kB)`,
  };
}

export function angleOrNull(id: string): Angle | null {
  return ANGLES[id] ?? null;
}
