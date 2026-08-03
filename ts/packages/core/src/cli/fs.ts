import { readFile } from 'node:fs/promises';

// Read a text file, or null when it cannot be read. The CLIs branch on
// null to pick the right exit code; the reason (missing vs unreadable)
// does not change what they can do about it.
export async function tryReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
