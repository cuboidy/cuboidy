import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isIdentifier } from '../identifier.js';
import { parseCvox } from '../cvox/parse.js';
import { serializeCvox } from '../cvox/serialize.js';
import {
  duplicatePart,
  mirrorPart,
  remapPartPalette,
  type Axis,
} from '../cvox/transform.js';
import type { Cvox, Part } from '../cvox/types.js';

// `cuboidy-part`: author concrete geometry by copying or mirroring an
// existing part into a (same or other) cvox file. Replaces the declarative
// clone/mirror grammar — the output is plain voxel data, so an AI model
// generator can build symmetric limbs by running this rather than emitting a
// reuse clause. All real work is here; the bin is a thin arg shell.

export interface PartOp {
  op: 'duplicate' | 'mirror';
  fromFile: string;
  fromPart: string;
  toFile: string;
  toPart: string;
  // Mirror axis (mirror only); defaults to 'x'.
  axis?: Axis;
}

export interface RunResult {
  text: string;
  exitCode: number;
}

async function readCvox(
  path: string,
): Promise<{ cvox: Cvox } | { error: string; code: number }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { error: `cannot read ${path}`, code: 2 };
  }
  const r = parseCvox(text);
  if (!r.ok) return { error: `${path}: ${r.message}`, code: 1 };
  return { cvox: r.value };
}

export async function runPart(op: PartOp): Promise<RunResult> {
  if (!isIdentifier(op.toPart)) {
    return { text: `invalid part name "${op.toPart}"`, exitCode: 2 };
  }

  const fromR = await readCvox(op.fromFile);
  if ('error' in fromR) return { text: fromR.error, exitCode: fromR.code };
  const fromCvox = fromR.cvox;

  const src = fromCvox.parts.find((p) => p.name === op.fromPart);
  if (src === undefined) {
    return {
      text: `part "${op.fromPart}" not found in ${op.fromFile}`,
      exitCode: 1,
    };
  }

  // Same destination file (by resolved path) reuses the already-parsed AST,
  // so a same-file copy sees the part it's appending next to.
  const sameFile = resolve(op.fromFile) === resolve(op.toFile);
  let toCvox: Cvox;
  if (sameFile) {
    toCvox = fromCvox;
  } else {
    const toR = await readCvox(op.toFile);
    if ('error' in toR) return { text: toR.error, exitCode: toR.code };
    toCvox = toR.cvox;
  }

  if (toCvox.parts.some((p) => p.name === op.toPart)) {
    return {
      text: `part "${op.toPart}" already exists in ${op.toFile}`,
      exitCode: 1,
    };
  }

  let newPart: Part =
    op.op === 'mirror'
      ? mirrorPart(src, op.axis ?? 'x', op.toPart)
      : duplicatePart(src, op.toPart);

  // Cross-file: the source indices mean colors in from.cvox's inline palette,
  // so remap them into to.cvox's (appending any it lacks). Same file needs no
  // remap — the indices already resolve against the one palette.
  let palette = toCvox.palette;
  if (!sameFile) {
    const remapped = remapPartPalette(newPart, fromCvox.palette, toCvox.palette);
    newPart = remapped.part;
    palette = remapped.palette;
  }

  const nextTo: Cvox = {
    ...toCvox,
    palette,
    parts: [...toCvox.parts, newPart],
  };
  try {
    await writeFile(op.toFile, serializeCvox(nextTo));
  } catch (e) {
    return {
      text: `cannot write ${op.toFile}: ${(e as Error).message}`,
      exitCode: 2,
    };
  }
  const how =
    op.op === 'mirror' ? `mirror(${op.axis ?? 'x'})` : 'duplicate';
  return {
    text: `${how}: wrote "${op.toPart}" to ${op.toFile}`,
    exitCode: 0,
  };
}
