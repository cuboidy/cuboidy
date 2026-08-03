import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Angle } from '../render/camera.js';
import { buildSceneFromParts, type OrientedPart, type Scene } from '../render/scene.js';
import { computeGlobalScale, renderTile } from '../render/snapshot.js';
import { encodeGif } from '../render/gif.js';
import { sampleAnimation, type InlineAnimation } from '../animation.js';
import { computeWorldTransforms, type Vec3Tuple } from '../rig-transform.js';
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
  /**
   * Sweep the camera a full turn about +Y over the animation, starting
   * from `angle`. Combines with a clip (the model animates while you
   * orbit it) and also stands alone, which is the only way to get a GIF
   * out of a model that has no animation at all.
   */
  orbit?: boolean | undefined;
  /**
   * Play the clip this many times over one revolution. Without it an
   * orbit is bound to the clip's length — a 1-second walk would spin the
   * camera a full turn per second, which is unwatchable. Ignored when
   * there is no clip. Default 1.
   */
  loops?: number | undefined;
  /**
   * Write the uncovered pixels as GIF's transparent index instead of
   * `bg`, so the model sits on whatever the page behind it is. Coverage
   * comes from the depth buffer, not from matching `bg`, so a model
   * containing the background colour keeps those pixels.
   */
  transparent?: boolean | undefined;
}

/** Frames in a turntable when there is no clip duration to derive one from. */
export const DEFAULT_ORBIT_FRAMES = 48;

export interface GifRunResult {
  exitCode: 0 | 1 | 2;
  text: string;
  gif?: Buffer;
  outPath?: string;
}

export const DEFAULT_BG: Rgb = [0.42, 0.44, 0.47];

export function renderGif(
  asm: Assembly,
  clipName: string | null,
  opts: GifOptions,
): { gif: Buffer; frames: number; duration: number } {
  let anim: InlineAnimation | null = null;
  if (clipName !== null) {
    const found = asm.animations.get(clipName);
    if (found === undefined) throw new Error(`unknown clip '${clipName}'`);
    anim = found;
  } else if (opts.orbit !== true) {
    throw new Error('renderGif: nothing would move — pass a clip or orbit');
  }

  // Geometry-side pivot rotations, rebuilt from the resolved parts so
  // the animated transform chain sees exactly what the rest one does.
  const pivotRots = new Map<string, Vec3Tuple>();
  for (const rp of asm.resolvedParts) {
    const rot = rp.part.pivot.rot;
    if (rot !== undefined) pivotRots.set(rp.name, [rot.x, rot.y, rot.z]);
  }

  const duration = anim?.duration ?? 0;
  // One pass of the clip. A still model has no duration to derive from,
  // so its "loop" is however many steps the turntable takes.
  const perLoop = Math.max(
    2,
    opts.frames ??
      (anim !== null ? Math.round(duration * opts.fps) : DEFAULT_ORBIT_FRAMES),
  );
  // The clip repeats under a single revolution, so the two can have
  // different periods and the GIF still closes on both.
  const loops = anim !== null ? Math.max(1, Math.trunc(opts.loops ?? 1)) : 1;
  const frameCount = perLoop * loops;

  // One camera orientation per frame. A turn is spread over the whole
  // GIF so it closes seamlessly on loop, and the elevation of the chosen
  // angle is kept — you orbit at the height you asked to look from.
  const angles: Angle[] = [];
  for (let i = 0; i < frameCount; i++) {
    if (opts.orbit !== true) {
      angles.push(opts.angle);
      continue;
    }
    const az = opts.angle.az + (i / frameCount) * 360;
    angles.push({ ...opts.angle, id: `${opts.angle.id}+${i}`, az });
  }

  // Pass 1: build one pass of the clip's scenes, and union their bounds.
  // Later loops reuse them — the poses repeat, only the camera differs.
  const scenes: Scene[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < perLoop; i++) {
    // Sample over [0, duration): the frame AT duration is the frame at 0
    // (§6.7), so including both ends would hold the first pose twice.
    const poses: ReturnType<typeof sampleAnimation> =
      anim === null
        ? new Map()
        : sampleAnimation(anim, (i / perLoop) * duration);

    // Pose is structurally an AnimPose (rot/pos plus fields the rig
    // ignores), so the sampled map passes straight through.
    const transforms = computeWorldTransforms(
      asm.manifest.parts,
      pivotRots,
      poses,
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

    // A still model only needs building once; the camera is what moves.
    if (anim === null) break;
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
  // One scale for every frame AND every viewpoint: computeGlobalScale
  // already takes the minimum across a set of angles, which is exactly
  // what an orbit needs — a model wider than it is deep must not grow
  // as it turns to face the camera edge-on.
  const scale = computeGlobalScale(union, angles, renderOpts);

  // Pass 2: render each frame against that fixed scale, cycling the
  // clip's scenes under a camera that keeps going.
  const frames = Array.from({ length: frameCount }, (_, i) => {
    const s = scenes[i % scenes.length]!;
    const fb = renderTile(
      { ...s, center: union.center, min: union.min, max: union.max },
      angles[i]!,
      scale,
      renderOpts,
    );
    return {
      rgba: fb.toRgba(),
      ...(opts.transparent === true ? { mask: fb.coverage() } : {}),
    };
  });

  // GIF delays are hundredths of a second and integral, so the achieved
  // rate is quantised. 10 cs (10 fps) and 5 cs (20 fps) land exactly.
  const delayCs = Math.max(2, Math.round(100 / opts.fps));
  const gif = encodeGif(frames, {
    width: opts.size,
    height: opts.size,
    delayCs,
  });
  return { gif, frames: frameCount, duration };
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
  if (opts.clip !== undefined && !asm.animations.has(opts.clip)) {
    return {
      exitCode: 1,
      text:
        `cuboidy-gif: unknown clip '${opts.clip}' — ` +
        (names.length > 0
          ? `${asm.manifest.name} has ${names.map((n) => `'${n}'`).join(', ')}`
          : `${asm.manifest.name} defines no animations`),
    };
  }
  // With --orbit a still model is a perfectly good subject, so no clip
  // is only an error when nothing else would move.
  const clip = opts.clip ?? names[0] ?? null;
  if (clip === null && opts.orbit !== true) {
    return {
      exitCode: 1,
      text:
        `cuboidy-gif: ${asm.manifest.name} defines no animations — ` +
        `use --orbit to turn it on the spot instead`,
    };
  }

  const { gif, frames, duration } = renderGif(asm, clip, opts);
  const label = clip ?? 'turntable';
  const outPath =
    opts.outFile ?? join(resolve(dir), `${asm.manifest.name}-${label}.gif`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, gif);

  const what =
    clip === null
      ? `turntable (${frames} frames`
      : `clip: ${clip} (${duration}s, ${frames} frames`;
  const view = opts.orbit === true ? `orbit from ${opts.angle.label}` : opts.angle.label;
  const kb = (gif.length / 1024).toFixed(1);
  return {
    exitCode: 0,
    gif,
    outPath,
    text: `model: ${asm.manifest.name}  ${what}, ${view})\nwrote ${outPath} (${kb} kB)`,
  };
}

