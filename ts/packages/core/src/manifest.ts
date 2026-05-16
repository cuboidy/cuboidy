import { z } from 'zod';

const Identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/);

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const PartSchema = z.object({
  name: Identifier,
  parent: Identifier.optional(),
  position: Vec3.optional(),
});

export const ManifestSchema = z.object({
  name: Identifier,
  version: z.string().optional(),
  parts: z.array(PartSchema).min(1),
  animations: z.record(z.string(), z.unknown()).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Part = z.infer<typeof PartSchema>;
