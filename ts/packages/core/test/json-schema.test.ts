import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildManifestJsonSchema } from '../src/json-schema.js';
import { parseManifest } from '../src/manifest.js';
import { RESERVED_KEYWORDS } from '../src/cvox/reserved.js';
import { IDENTIFIER_RE } from '../src/identifier.js';
import { readFixtureJson } from './helpers/fixtures.js';

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

  it('accepts wolf/cuboidy.json', async () => {
    await expectParity('wolf', 'models/wolf/cuboidy.json');
  });

  it('accepts crown/cuboidy.json', async () => {
    await expectParity('crown', 'models/crown/cuboidy.json');
  });

  it('rejects fixtures/json/missing/name.json', async () => {
    await expectParity('missing name', 'fixtures/json/missing/name.json');
  });

  it('rejects fixtures/json/missing/parts.json (empty parts)', async () => {
    await expectParity('missing parts', 'fixtures/json/missing/parts.json');
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
