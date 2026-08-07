import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020Module from 'ajv/dist/2020.js';

// `ajv/dist/2020.js` is CommonJS. Under Node's ESM interop the class arrives
// as `.default` on the namespace object, and ajv's own typings describe the
// namespace rather than the constructor — so the default import is not
// callable as far as tsc is concerned, however well it runs. Only `compile`
// is used here, so the surface asserted is that.
type AjvValidator = (data: unknown) => boolean;
type AjvCtor = new (opts?: { allErrors?: boolean }) => {
  compile: (schema: object) => AjvValidator;
};
const Ajv2020 = (Ajv2020Module as unknown as { default?: AjvCtor }).default ??
  (Ajv2020Module as unknown as AjvCtor);
import { buildManifestJsonSchema } from '../src/json-schema.js';
import { parseManifest } from '../src/manifest.js';
import { RESERVED_KEYWORDS } from '../src/identifier.js';
import { IDENTIFIER_RE } from '../src/identifier.js';
import { readFixtureJson } from './helpers/fixtures.js';
import { MULTIFILE, RIGGED, SINGLE } from './helpers/corpus.js';

// Loads the committed schema artifact (the deliverable consumers fetch).
const SCHEMA_PATH = new URL(
  '../../../../schema/cuboidy.schema.json',
  import.meta.url,
);
const committedSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as unknown;

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(committedSchema as object);

describe('cuboidy.schema.json — committed artifact', () => {
  it('carries the expected metadata ($schema, $id, title)', () => {
    expect(committedSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://cuboidy.com/schema/cuboidy.schema.json',
      title: 'Cuboidy Manifest',
    });
  });

  it('encodes the identifier regex + reserved-keyword rejection at every identifier slot', () => {
    // Both `name` (top-level) and `parts[].name` / `parts[].parent` should
    // carry the same shape — pattern + not.enum. If a future Zod refactor
    // introduces a new identifier slot, this test will catch the missing
    // injection (it does a structural match against the committed file).
    const expected = {
      type: 'string',
      pattern: IDENTIFIER_RE.source,
      not: { enum: [...RESERVED_KEYWORDS] },
    };
    const schemaObj = committedSchema as Record<string, any>;
    expect(schemaObj.properties.name).toMatchObject(expected);
    expect(schemaObj.properties.parts.items.properties.name).toMatchObject(expected);
    expect(schemaObj.properties.parts.items.properties.parent).toMatchObject(expected);
  });
});

describe('cuboidy.schema.json — validation parity with parseManifest', () => {
  // The JSON Schema is the third-party tooling deliverable; parseManifest
  // (Zod) is the in-process authoritative validator. They MUST agree on
  // every input we feed both — otherwise external tools and the runtime
  // would disagree about what's a valid model.
  async function expectParity(name: string, jsonPath: string) {
    const json = await readFixtureJson(jsonPath);
    const zodOk = parseManifest(json).ok;
    const ajvOk = validate(json);
    expect(ajvOk, `${name}: ajv=${ajvOk} zod=${zodOk}`).toBe(zodOk);
  }

  it('accepts a rigged manifest', async () => {
    await expectParity('rigged', `${RIGGED}/cuboidy.json`);
  });

  it('accepts a single-part manifest', async () => {
    await expectParity('single', `${SINGLE}/cuboidy.json`);
  });

  it('rejects fixtures/manifest/missing/name.json', async () => {
    await expectParity('missing name', 'fixtures/manifest/missing/name.json');
  });

  it('rejects fixtures/manifest/missing/parts.json (empty parts)', async () => {
    await expectParity('missing parts', 'fixtures/manifest/missing/parts.json');
  });
});

describe('cuboidy.schema.json — parity corpus (runtime-invalid inputs)', () => {
  // Inputs parseManifest rejects that the generated schema once accepted —
  // Zod refinements and tuple lengths did not survive the conversion. Both
  // validators must now agree, or "shared schema" guarantees nothing.
  function expectBothReject(name: string, manifest: unknown) {
    const ajvOk = validate(manifest);
    const zodOk = parseManifest(manifest).ok;
    expect(zodOk, `${name}: zod should reject`).toBe(false);
    expect(ajvOk, `${name}: ajv should reject (parity)`).toBe(false);
  }

  const base = { name: 'm', parts: [{ name: 'body' }] };

  it('rejects wrong-arity position tuples', () => {
    expectBothReject('empty position', {
      ...base,
      parts: [{ name: 'body', position: [] }],
    });
    expectBothReject('2-elem position', {
      ...base,
      parts: [{ name: 'body', position: [1, 2] }],
    });
    expectBothReject('4-elem position', {
      ...base,
      parts: [{ name: 'body', position: [1, 2, 3, 4] }],
    });
  });

  it('rejects wrong-arity keyframe tuples', () => {
    expectBothReject('2-elem rot', {
      ...base,
      animations: {
        walk: {
          duration: 1,
          loop: true,
          parts: { body: { '0.0': { rot: [1, 2] } } },
        },
      },
    });
  });

  it('rejects duplicate geometry entries', () => {
    expectBothReject('dup geometry', {
      ...base,
      geometry: ['voxels.json', 'voxels.json'],
    });
  });

  it('rejects §8-violating geometry refs', () => {
    for (const bad of [
      '/absolute.json',
      'a\\b.json',
      'x.txt',
      'a//b.json',
      'http://x/a.json',
      '.json',
      // The retired text extension is no longer a valid geometry reference.
      'voxels.geometry',
    ]) {
      expectBothReject(`geometry ${bad}`, { ...base, geometry: [bad] });
    }
  });

  it('rejects §8-violating animation refs', () => {
    expectBothReject('anim /abs.json', {
      ...base,
      animations: { walk: '/abs.json' },
    });
    expectBothReject('anim walk.txt', {
      ...base,
      animations: { walk: 'walk.txt' },
    });
  });

  it('accepts a geometry list + external palette + valid refs', async () => {
    const json = await readFixtureJson(`${MULTIFILE}/cuboidy.json`);
    expect(parseManifest(json).ok).toBe(true);
    expect(validate(json)).toBe(true);
  });
});

describe('cuboidy.schema.json — documented runtime-only rules', () => {
  // These SPEC §11.5 rules are Zod superRefines that JSON Schema cannot
  // express; the schema description names them. This test pins the gap
  // intentionally — if the schema ever starts rejecting one, update the
  // description and move the case into the parity corpus above.
  function expectSchemaOnlyAccepts(name: string, manifest: unknown) {
    expect(validate(manifest), `${name}: ajv accepts (documented gap)`).toBe(true);
    expect(parseManifest(manifest).ok, `${name}: zod rejects`).toBe(false);
  }

  it('duplicate part names', () => {
    expectSchemaOnlyAccepts('dup part', {
      name: 'm',
      parts: [{ name: 'body' }, { name: 'body' }],
    });
  });

  it('dangling parent / parent cycle', () => {
    expectSchemaOnlyAccepts('dangling parent', {
      name: 'm',
      parts: [{ name: 'body', parent: 'ghost' }],
    });
    expectSchemaOnlyAccepts('cycle', {
      name: 'm',
      parts: [
        { name: 'a', parent: 'b' },
        { name: 'b', parent: 'a' },
      ],
    });
  });

  it('animation semantic rules', () => {
    expectSchemaOnlyAccepts('non-positive duration', {
      name: 'm',
      parts: [{ name: 'body' }],
      animations: { walk: { duration: 0, loop: true, parts: {} } },
    });
    expectSchemaOnlyAccepts('track not starting at 0.0', {
      name: 'm',
      parts: [{ name: 'body' }],
      animations: {
        walk: {
          duration: 1,
          loop: true,
          parts: { body: { '0.5': { rot: [0, 0, 0] } } },
        },
      },
    });
  });
});

describe('cuboidy.schema.json — reserved-keyword rejection', () => {
  it.each(RESERVED_KEYWORDS)(
    'rejects manifest with name="%s" (matches Zod refine behavior)',
    (name) => {
      const manifest = { name, parts: [{ name: 'body' }] };
      expect(validate(manifest)).toBe(false);
      expect(parseManifest(manifest).ok).toBe(false);
    },
  );

  it('rejects a part named after a reserved keyword', () => {
    const manifest = { name: 'wolf', parts: [{ name: 'palette' }] };
    expect(validate(manifest)).toBe(false);
    expect(parseManifest(manifest).ok).toBe(false);
  });
});

describe('cuboidy.schema.json — drift check', () => {
  // Committed schema must equal what buildManifestJsonSchema() produces
  // right now. If a Zod schema edit changes the output but the file isn't
  // regenerated, this fails and prompts running `npm run generate:schema`.
  // Goes through the same builder the generator script uses — no logic
  // duplication.
  it('committed file equals a fresh buildManifestJsonSchema() output', () => {
    const fresh = buildManifestJsonSchema();
    expect(committedSchema).toEqual(fresh);
  });
});
