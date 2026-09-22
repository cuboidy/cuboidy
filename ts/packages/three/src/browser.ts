// The entry point of the browser bundles, and the only difference from
// `index.ts`: it carries `@cuboidy/core` out with it.
//
// A page with no build step has no other way to get one. It holds JSON
// text and wants a model on screen, and everything between those two —
// `parseManifest`, `resolveProject`, `sampleAnimation` — is core's. Leaving
// it out would ship a renderer with nothing it could render.
//
// It costs almost nothing to include, either: core's parser is Zod-backed,
// so Zod is in the bundle whether or not its exports are reachable.
export * from './index.js';
export * from '@cuboidy/core';
