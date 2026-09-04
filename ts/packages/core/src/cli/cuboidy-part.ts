#!/usr/bin/env node
import { runPart, type PartOp } from './part-runner.js';
import type { Axis } from '../geometry/transform.js';

// CLI shell for `cuboidy-part`. All real work lives in part-runner.ts.
//   duplicate <from.json> <fromPart> <to.json> <toPart>  — copy a part
//   mirror    <file.json> <part> [x|y|z]                 — flip it in place

const HELP_TEXT =
  'Usage:\n' +
  '  cuboidy-part duplicate  <from.json> <fromPart> <to.json> <toPart>\n' +
  '  cuboidy-part mirror     <file.json> <part> [axis]\n' +
  '  cuboidy-part move-pivot <dir> <part> <x>,<y>,<z> [--dry-run]\n' +
  '\n' +
  'Author concrete geometry (plain voxel data — no clone/mirror reference).\n' +
  '\n' +
  'duplicate — copy <fromPart> into <to.json> as <toPart> (written in place;\n' +
  '            from and to may be the same file). When to.json differs and\n' +
  "            their inline palettes differ, the copy's voxels are remapped\n" +
  "            into to.json's palette (missing colors appended) so it keeps\n" +
  '            its colors.\n' +
  '\n' +
  'mirror    — reflect <part> across [axis] IN PLACE (same name), rewriting\n' +
  '            <file.json>. axis is x|y|z; default x. To make a mirrored\n' +
  '            copy for the other side, duplicate first, then mirror the copy.\n' +
  '\n' +
  'move-pivot — put the pivot at <x>,<y>,<z> in part-local coordinates and\n' +
  '            leave every voxel exactly where it was. WHERE the pivot should\n' +
  '            go is your decision, not this command\'s: a limb usually wants\n' +
  '            it at the cross-section centre so a scale offset moves all four\n' +
  '            side faces, a hinge wants it on the axis line, a rotor arm at\n' +
  '            the root of the sweep.\n' +
  '\n' +
  '            Takes the model DIRECTORY, because the correction spans two\n' +
  '            files -- the pivot is in the geometry and the position that\n' +
  '            cancels the move is in the manifest -- and every direct child\n' +
  '            needs its own position corrected too, since a child is placed\n' +
  '            from its PARENT\'S PIVOT. Doing one of those and not the others\n' +
  '            is what this exists to prevent, so the input cannot express it.\n' +
  '\n' +
  '            That mistake is close to invisible otherwise. Measured on a\n' +
  '            zombie forearm: an uncompensated one-voxel pivot move left\n' +
  '            lint, cuboidy-overlap, the bbox and even --transforms\n' +
  '            byte-identical (the transform reports the PIVOT\'s world\n' +
  '            position, which is what did not move), while cuboidy-clash\n' +
  '            went 57 to 49 -- the one number that moves moves in the\n' +
  '            reassuring direction. So this verifies its own work: it\n' +
  '            compares every drawn face\'s world position before and after\n' +
  '            and rolls both files back if any of them moved.\n' +
  '\n' +
  '            Only the numbers it changes are rewritten. The manifests are\n' +
  '            hand-formatted and read by hand, and a parse/print round trip\n' +
  '            would put every line of one in the diff.\n' +
  '\n' +
  'Options:\n' +
  '  --dry-run        print the edits and write nothing\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  written\n' +
  '  1  parse / lookup error (bad geometry, unknown part, name clash)\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

function parseArgs(
  argv: readonly string[],
): PartOp | { help: true } | { error: string } {
  const positional: string[] = [];
  let dryRun = false;
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    // A negative pivot coordinate starts with '-' and is not a flag.
    if (a.startsWith('-') && !/^-?[\d.]/.test(a.slice(1))) {
      return { error: `unknown flag "${a}"` };
    }
    positional.push(a);
  }
  const [op, ...rest] = positional;

  if (op === 'move-pivot') {
    const [dir, part, coords, ...extra] = rest;
    if (dir === undefined || part === undefined || coords === undefined) {
      return { error: 'move-pivot expects <dir> <part> <x>,<y>,<z>' };
    }
    if (extra.length > 0) return { error: `unexpected argument "${extra[0]}"` };
    const n = coords.split(',').map((s) => Number(s.trim()));
    if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) {
      return { error: `move-pivot coordinates must be x,y,z (got "${coords}")` };
    }
    return { op, dir, part, to: [n[0]!, n[1]!, n[2]!], dryRun };
  }

  if (dryRun) return { error: '--dry-run applies to move-pivot only' };

  if (op === 'duplicate') {
    const [fromFile, fromPart, toFile, toPart, ...extra] = rest;
    if (
      fromFile === undefined ||
      fromPart === undefined ||
      toFile === undefined ||
      toPart === undefined
    ) {
      return {
        error: 'duplicate expects <from.json> <fromPart> <to.json> <toPart>',
      };
    }
    if (extra.length > 0) return { error: `unexpected argument "${extra[0]}"` };
    return { op, fromFile, fromPart, toFile, toPart };
  }

  if (op === 'mirror') {
    const [file, part, axis, ...extra] = rest;
    if (file === undefined || part === undefined) {
      return { error: 'mirror expects <file.json> <part> [axis]' };
    }
    if (axis !== undefined && axis !== 'x' && axis !== 'y' && axis !== 'z') {
      return { error: `mirror axis must be x, y or z (got "${axis}")` };
    }
    if (extra.length > 0) return { error: `unexpected argument "${extra[0]}"` };
    return { op, file, part, axis: (axis ?? 'x') as Axis };
  }

  return { error: 'first argument must be "duplicate" or "mirror"' };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-part: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const result = await runPart(parsed);
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${result.text}\n`);
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-part: ${msg}\n`);
    process.exit(2);
  });
