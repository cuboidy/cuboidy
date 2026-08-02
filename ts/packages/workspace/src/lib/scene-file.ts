import type { Instance, Scene } from './scene.js';

// The `*.scene.json` file: an arrangement of models, on disk.
//
// NOT a Cuboidy file. The SPEC deliberately says nothing about
// composition — a model states what it OFFERS (§6.12) and never what it
// is used in — so this format belongs to the workspace and is versioned
// separately. It sits in the same folder as the packages it references,
// which is exactly why it carries a `format` marker: a reader that finds
// it must be able to tell at a glance that it is not a manifest.
//
// It references models by LIBRARY KEY (the folder name), not by path.
// A scene is meaningful only inside the library it was built from, and
// pretending otherwise with relative paths would invite a scene that
// half-resolves against a different folder.

export const SCENE_FORMAT = 'cuboidy-scene';
export const SCENE_VERSION = 1;
export const SCENE_EXT = '.scene.json';

export type ParseResult =
  | { ok: true; scene: Scene }
  | { ok: false; error: string };

// Written with defaults omitted: a free instance at the origin with no
// clip is `{ "id": …, "model": … }`. Scenes are meant to be read and
// diffed by hand, and a file full of zeroes hides the parts that matter.
export function serializeScene(scene: Scene): string {
  return (
    JSON.stringify(
      {
        format: SCENE_FORMAT,
        version: SCENE_VERSION,
        instances: scene.instances.map((i) => ({
          id: i.id,
          model: i.model,
          ...(i.attach !== undefined && { attach: i.attach }),
          ...(isZero(i.placement.pos) ? {} : { pos: i.placement.pos }),
          ...(i.placement.rot === undefined || isZero(i.placement.rot)
            ? {}
            : { rot: i.placement.rot }),
          ...(i.anim !== undefined && { anim: i.anim }),
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

export function parseScene(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not JSON: ${(e as Error).message}` };
  }
  if (!isObject(json)) return { ok: false, error: 'not an object' };

  // Checked before anything else: the likeliest wrong file to be handed
  // is a cuboidy.json, and "expected a scene, found a model" is a more
  // useful thing to say than a complaint about a missing `instances`.
  if (json['format'] !== SCENE_FORMAT) {
    const looksLikeModel = isObject(json) && 'parts' in json;
    return {
      ok: false,
      error: looksLikeModel
        ? `missing "format": "${SCENE_FORMAT}" — this looks like a Cuboidy model, not a scene`
        : `missing "format": "${SCENE_FORMAT}"`,
    };
  }
  if (json['version'] !== SCENE_VERSION) {
    return {
      ok: false,
      error: `version ${String(json['version'])} — this workspace reads version ${SCENE_VERSION}`,
    };
  }
  const rawInstances = json['instances'];
  if (!Array.isArray(rawInstances)) {
    return { ok: false, error: '`instances` must be an array' };
  }

  const instances: Instance[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of rawInstances.entries()) {
    const at = `instances[${i}]`;
    if (!isObject(raw)) return { ok: false, error: `${at}: not an object` };
    const id = raw['id'];
    const model = raw['model'];
    if (typeof id !== 'string' || id === '') {
      return { ok: false, error: `${at}: \`id\` must be a non-empty string` };
    }
    if (typeof model !== 'string' || model === '') {
      return { ok: false, error: `${at}: \`model\` must be a non-empty string` };
    }
    // Ids address instances — an attachment names its host by one — so a
    // duplicate would make the reference ambiguous rather than merely untidy.
    if (seen.has(id)) return { ok: false, error: `${at}: duplicate id '${id}'` };
    seen.add(id);

    const inst: Instance = { id, model, placement: { pos: readVec(raw['pos']) } };
    // ZXY euler degrees (§4's convention, borrowed). Omitted when the
    // instance is not turned, so a `rot` in a file is always a real one.
    const rot = raw['rot'];
    if (rot !== undefined) inst.placement.rot = readVec(rot);

    const attach = raw['attach'];
    if (attach !== undefined) {
      if (
        !isObject(attach) ||
        typeof attach['to'] !== 'string' ||
        typeof attach['socket'] !== 'string'
      ) {
        return { ok: false, error: `${at}: \`attach\` needs \`to\` and \`socket\`` };
      }
      inst.attach = { to: attach['to'], socket: attach['socket'] };
    }

    const anim = raw['anim'];
    if (anim !== undefined) {
      if (!isObject(anim) || typeof anim['clip'] !== 'string') {
        return { ok: false, error: `${at}: \`anim\` needs a \`clip\`` };
      }
      inst.anim = { clip: anim['clip'], playing: anim['playing'] === true };
      // The frozen point of a paused instance. Persisted because a
      // paused pose IS part of what the scene looks like — reopening
      // should give back the frame that was saved, not frame zero.
      if (typeof anim['at'] === 'number' && isFinite(anim['at'])) {
        inst.anim.at = anim['at'];
      }
    }
    instances.push(inst);
  }

  // Any `name` in the file is READ AND IGNORED. Files written before the
  // filename became the scene's identity still carry one, and they still
  // open — there is simply nothing left for it to disagree with. Nothing
  // writes it any more, so those copies age out on the next save.
  //
  // A host that is not in the file, or a socket a model has stopped
  // publishing, is NOT rejected here: placeScene reports both against the
  // instance and still draws it. A scene must survive its models changing
  // under it, which is the normal case for a file that outlives an edit.
  return { ok: true, scene: { instances } };
}

function isZero(v: readonly number[]): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

function readVec(v: unknown): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) return [0, 0, 0];
  const [x, y, z] = v;
  return [num(x), num(y), num(z)];
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
