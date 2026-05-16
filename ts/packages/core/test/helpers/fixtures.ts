import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

export async function readFixtureText(relPath: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, relPath), 'utf-8');
}

export async function readFixtureJson(relPath: string): Promise<unknown> {
  const text = await readFixtureText(relPath);
  return JSON.parse(text);
}
