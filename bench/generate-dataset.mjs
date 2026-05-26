// Generates a dataset of paired (CVOX, JSON) representations for token-count
// comparison. Each model is defined as an in-memory object and emitted in
// three forms:
//   - <name>.cvox       — canonical CVOX text per SPEC §7
//   - <name>.json       — pretty JSON (2-space), the "natural" representation
//   - <name>.min.json   — minified JSON (lower bound)
//
// The CVOX serializer here is intentionally simple — it produces the same
// shape as the existing fixtures in models/wolf/ and models/crown/, including
// indented metadata and a voxels { ... } block with one row per line.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'dataset');
mkdirSync(OUT_DIR, { recursive: true });

const AIR = -1;

// ----- voxel utilities ---------------------------------------------------

function indexToChar(i) {
  if (i === AIR) return '.';
  if (i <= 9) return String(i);
  if (i <= 35) return String.fromCharCode(97 + i - 10);   // a..z
  return String.fromCharCode(65 + i - 36);                // A..Z
}

// Build a [Y][Z][X] voxel grid of the given size, fill by a function.
function grid([w, h, d], fn) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const layer = [];
    for (let z = 0; z < d; z++) {
      const row = [];
      for (let x = 0; x < w; x++) row.push(fn(x, y, z));
      layer.push(row);
    }
    out.push(layer);
  }
  return out;
}

const solid = (i = 0) => () => i;
const air = () => AIR;

// Hollow box: cells on the outer shell, air inside.
const hollow = (size, i = 0) => (x, y, z) => {
  const [w, h, d] = size;
  if (x === 0 || x === w - 1 || y === 0 || y === h - 1 || z === 0 || z === d - 1) return i;
  return AIR;
};

// ----- CVOX serializer ---------------------------------------------------

function serializeCvox(model) {
  const lines = [];
  lines.push('palette ' + model.palette.join(' '));
  lines.push('');
  for (const p of model.parts) {
    lines.push(`part ${p.name}`);
    lines.push(`    size ${p.size.join(' ')}`);
    lines.push(`    pivot ${p.pivot.join(' ')}`);
    for (const s of p.sockets ?? []) {
      lines.push(`    socket ${s.name} ${s.pos.join(' ')}`);
    }
    lines.push('    voxels {');
    const [w, h, d] = p.size;
    for (let y = 0; y < h; y++) {
      if (y > 0) lines.push('        ,');
      for (let z = 0; z < d; z++) {
        const row = p.voxels[y][z].map(indexToChar).join('');
        lines.push('        ' + row);
      }
    }
    lines.push('    }');
    lines.push('');
  }
  // Drop the trailing blank line.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// Same content as serializeCvox but no leading indentation and no blank
// lines between parts. SPEC §7: whitespace (incl. newlines) is freely
// substitutable, so this is still valid cvox.
function serializeCvoxUnindented(model) {
  const lines = [];
  lines.push('palette ' + model.palette.join(' '));
  for (const p of model.parts) {
    lines.push(`part ${p.name}`);
    lines.push(`size ${p.size.join(' ')}`);
    lines.push(`pivot ${p.pivot.join(' ')}`);
    for (const s of p.sockets ?? []) {
      lines.push(`socket ${s.name} ${s.pos.join(' ')}`);
    }
    lines.push('voxels {');
    const [w, h, d] = p.size;
    for (let y = 0; y < h; y++) {
      if (y > 0) lines.push(',');
      for (let z = 0; z < d; z++) {
        lines.push(p.voxels[y][z].map(indexToChar).join(''));
      }
    }
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

// All tokens on a single line separated by spaces — the cvox equivalent of
// "minified". Voxel rows of fixed width W remain unambiguous because the
// parser splits on whitespace and validates each token against W.
function serializeCvoxMinified(model) {
  const tokens = [];
  tokens.push('palette', ...model.palette);
  for (const p of model.parts) {
    tokens.push('part', p.name);
    tokens.push('size', ...p.size.map(String));
    tokens.push('pivot', ...p.pivot.map(String));
    for (const s of p.sockets ?? []) {
      tokens.push('socket', s.name, ...s.pos.map(String));
    }
    tokens.push('voxels', '{');
    const [, h] = p.size;
    for (let y = 0; y < h; y++) {
      if (y > 0) tokens.push(',');
      for (const row of p.voxels[y]) {
        tokens.push(row.map(indexToChar).join(''));
      }
    }
    tokens.push('}');
  }
  return tokens.join(' ') + '\n';
}

// ----- JSON encoder ------------------------------------------------------

// Convert the in-memory model into a "natural" JSON-shaped object that
// uses the same data, just as plain JSON. This is the baseline we compare
// CVOX against.
function toJsonModel(model) {
  return {
    palette: model.palette,
    parts: model.parts.map((p) => {
      const out = {
        name: p.name,
        size: p.size,
        pivot: p.pivot,
      };
      if ((p.sockets ?? []).length > 0) {
        out.sockets = p.sockets.map((s) => ({ name: s.name, pos: s.pos }));
      }
      out.voxels = p.voxels;
      return out;
    }),
  };
}

// Hybrid variant: JSON shape, but voxel rows kept as cvox-style strings
// ("000", "0.0", ...). Each layer is an array of D row-strings of length W.
function toJsonStrModel(model) {
  return {
    palette: model.palette,
    parts: model.parts.map((p) => {
      const out = {
        name: p.name,
        size: p.size,
        pivot: p.pivot,
      };
      if ((p.sockets ?? []).length > 0) {
        out.sockets = p.sockets.map((s) => ({ name: s.name, pos: s.pos }));
      }
      out.voxels = p.voxels.map((layer) =>
        layer.map((row) => row.map(indexToChar).join('')),
      );
      return out;
    }),
  };
}

// ----- model definitions -------------------------------------------------

const models = {};

models.tiny = {
  palette: ['#FF0000'],
  parts: [
    { name: 'block', size: [1, 1, 1], pivot: [0, 0, 0], sockets: [], voxels: grid([1, 1, 1], solid(0)) },
  ],
};

models.crown = {
  palette: ['#FFD700'],
  parts: [
    {
      name: 'crown',
      size: [3, 2, 3],
      pivot: [1, 0, 1],
      sockets: [],
      voxels: [
        [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        [[0, AIR, 0], [AIR, AIR, AIR], [0, AIR, 0]],
      ],
    },
  ],
};

models.wolf = {
  palette: ['#8B4513', '#000000'],
  parts: [
    { name: 'body', size: [3, 2, 4], pivot: [1, 0, 2], sockets: [], voxels: grid([3, 2, 4], solid(0)) },
    {
      name: 'head',
      size: [3, 3, 3],
      pivot: [1, 0, 1],
      sockets: [
        { name: 'hat', pos: [1, 3, 1] },
        { name: 'mouth', pos: [1, 1, 3] },
      ],
      voxels: [
        [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        [[0, 0, 0], [0, 0, 0], [1, 0, 1]],
        [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      ],
    },
    { name: 'tail', size: [1, 1, 2], pivot: [0, 0, 2], sockets: [], voxels: grid([1, 1, 2], solid(0)) },
  ],
};

models.biped = {
  palette: ['#C68642', '#3F51B5', '#222222'],
  parts: [
    { name: 'head',   size: [3, 3, 3], pivot: [1, 0, 1], sockets: [{ name: 'hat', pos: [1, 3, 1] }], voxels: grid([3, 3, 3], solid(0)) },
    { name: 'torso',  size: [3, 4, 2], pivot: [1, 0, 1], sockets: [], voxels: grid([3, 4, 2], solid(1)) },
    { name: 'arm_l',  size: [1, 4, 1], pivot: [0, 4, 0], sockets: [{ name: 'hand', pos: [0, 0, 0] }], voxels: grid([1, 4, 1], solid(0)) },
    { name: 'arm_r',  size: [1, 4, 1], pivot: [0, 4, 0], sockets: [{ name: 'hand', pos: [0, 0, 0] }], voxels: grid([1, 4, 1], solid(0)) },
    { name: 'leg_l',  size: [1, 4, 1], pivot: [0, 4, 0], sockets: [], voxels: grid([1, 4, 1], solid(2)) },
    { name: 'leg_r',  size: [1, 4, 1], pivot: [0, 4, 0], sockets: [], voxels: grid([1, 4, 1], solid(2)) },
  ],
};

models.quadruped = {
  palette: ['#A0522D', '#000000'],
  parts: [
    { name: 'body',   size: [3, 2, 5], pivot: [1, 0, 2], sockets: [], voxels: grid([3, 2, 5], solid(0)) },
    { name: 'head',   size: [3, 3, 3], pivot: [1, 0, 1], sockets: [{ name: 'mouth', pos: [1, 1, 3] }], voxels: grid([3, 3, 3], solid(0)) },
    { name: 'leg_fl', size: [1, 3, 1], pivot: [0, 3, 0], sockets: [], voxels: grid([1, 3, 1], solid(0)) },
    { name: 'leg_fr', size: [1, 3, 1], pivot: [0, 3, 0], sockets: [], voxels: grid([1, 3, 1], solid(0)) },
    { name: 'leg_bl', size: [1, 3, 1], pivot: [0, 3, 0], sockets: [], voxels: grid([1, 3, 1], solid(0)) },
    { name: 'leg_br', size: [1, 3, 1], pivot: [0, 3, 0], sockets: [], voxels: grid([1, 3, 1], solid(0)) },
    { name: 'tail',   size: [1, 1, 3], pivot: [0, 0, 3], sockets: [], voxels: grid([1, 1, 3], solid(1)) },
  ],
};

models.bird = {
  palette: ['#F5D000', '#222222', '#FF8800'],
  parts: [
    { name: 'body',   size: [2, 2, 3], pivot: [1, 0, 1], sockets: [], voxels: grid([2, 2, 3], solid(0)) },
    { name: 'head',   size: [2, 2, 2], pivot: [1, 0, 1], sockets: [{ name: 'beak', pos: [1, 1, 2] }, { name: 'eye_l', pos: [0, 1, 1] }, { name: 'eye_r', pos: [2, 1, 1] }], voxels: grid([2, 2, 2], solid(0)) },
    { name: 'wing_l', size: [1, 1, 3], pivot: [0, 0, 1], sockets: [], voxels: grid([1, 1, 3], solid(0)) },
    { name: 'wing_r', size: [1, 1, 3], pivot: [1, 0, 1], sockets: [], voxels: grid([1, 1, 3], solid(0)) },
    { name: 'tail',   size: [2, 1, 2], pivot: [1, 0, 0], sockets: [], voxels: grid([2, 1, 2], solid(1)) },
  ],
};

models.mech = {
  palette: ['#777777', '#FF2200', '#00B0FF', '#222222'],
  parts: [
    { name: 'torso',    size: [5, 6, 3], pivot: [2, 0, 1], sockets: [{ name: 'cockpit', pos: [2, 4, 0] }], voxels: grid([5, 6, 3], hollow([5, 6, 3], 0)) },
    { name: 'head',     size: [3, 3, 3], pivot: [1, 0, 1], sockets: [{ name: 'antenna', pos: [1, 3, 1] }], voxels: grid([3, 3, 3], solid(0)) },
    { name: 'arm_l',    size: [2, 4, 2], pivot: [1, 4, 1], sockets: [{ name: 'wrist', pos: [1, 0, 1] }], voxels: grid([2, 4, 2], solid(3)) },
    { name: 'arm_r',    size: [2, 4, 2], pivot: [1, 4, 1], sockets: [{ name: 'wrist', pos: [1, 0, 1] }], voxels: grid([2, 4, 2], solid(3)) },
    { name: 'leg_l',    size: [2, 5, 2], pivot: [1, 5, 1], sockets: [], voxels: grid([2, 5, 2], solid(0)) },
    { name: 'leg_r',    size: [2, 5, 2], pivot: [1, 5, 1], sockets: [], voxels: grid([2, 5, 2], solid(0)) },
    { name: 'weapon_l', size: [1, 3, 1], pivot: [0, 0, 0], sockets: [], voxels: grid([1, 3, 1], solid(1)) },
    { name: 'weapon_r', size: [1, 3, 1], pivot: [0, 0, 0], sockets: [], voxels: grid([1, 3, 1], solid(2)) },
    { name: 'jetpack',  size: [3, 2, 1], pivot: [1, 0, 0], sockets: [], voxels: grid([3, 2, 1], solid(3)) },
  ],
};

models.castle_tile = {
  palette: ['#999999', '#444444'],
  parts: [
    {
      name: 'wall',
      size: [8, 6, 8],
      pivot: [4, 0, 4],
      sockets: [{ name: 'door', pos: [4, 0, 0] }, { name: 'flag', pos: [4, 6, 4] }],
      voxels: grid([8, 6, 8], (x, y, z) => {
        // Outer wall on x=0/x=7/z=0/z=7, alternating top crenellations on y=5.
        const onEdgeXZ = x === 0 || x === 7 || z === 0 || z === 7;
        if (!onEdgeXZ) return AIR;
        if (y === 5) return (x + z) % 2 === 0 ? 1 : AIR;
        return 0;
      }),
    },
  ],
};

// ----- emit --------------------------------------------------------------

const summary = [];
for (const [name, model] of Object.entries(models)) {
  const cvox = serializeCvox(model);
  const cvoxUnindent = serializeCvoxUnindented(model);
  const cvoxMin = serializeCvoxMinified(model);
  const jsonModel = toJsonModel(model);
  const jsonStrModel = toJsonStrModel(model);
  const jsonPretty = JSON.stringify(jsonModel, null, 2);
  const jsonMin = JSON.stringify(jsonModel);
  const jsonStrPretty = JSON.stringify(jsonStrModel, null, 2);
  const jsonStrMin = JSON.stringify(jsonStrModel);
  writeFileSync(join(OUT_DIR, `${name}.cvox`), cvox);
  writeFileSync(join(OUT_DIR, `${name}.unindent.cvox`), cvoxUnindent);
  writeFileSync(join(OUT_DIR, `${name}.min.cvox`), cvoxMin);
  writeFileSync(join(OUT_DIR, `${name}.json`), jsonPretty + '\n');
  writeFileSync(join(OUT_DIR, `${name}.min.json`), jsonMin + '\n');
  writeFileSync(join(OUT_DIR, `${name}.str.json`), jsonStrPretty + '\n');
  writeFileSync(join(OUT_DIR, `${name}.str.min.json`), jsonStrMin + '\n');
  summary.push({
    name,
    parts: model.parts.length,
    voxels: model.parts.reduce((n, p) => n + p.size[0] * p.size[1] * p.size[2], 0),
    cvoxBytes: Buffer.byteLength(cvox, 'utf8'),
    cvoxUnindentBytes: Buffer.byteLength(cvoxUnindent, 'utf8'),
    cvoxMinBytes: Buffer.byteLength(cvoxMin, 'utf8'),
    jsonBytes: Buffer.byteLength(jsonPretty, 'utf8'),
    minBytes: Buffer.byteLength(jsonMin, 'utf8'),
    strBytes: Buffer.byteLength(jsonStrPretty, 'utf8'),
    strMinBytes: Buffer.byteLength(jsonStrMin, 'utf8'),
  });
}

console.table(summary);
console.log(`\nWrote ${summary.length} model(s) to ${OUT_DIR}`);
