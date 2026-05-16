// SPEC §7.11: A `//` sequence anywhere on a line starts a comment that runs
// to end of line. The `/` character does not appear in any valid Cuboidy token
// (voxel-row chars, identifiers, hex, numbers), so `//` is unambiguous and
// requires no whitespace-context check.
export function stripComment(line: string): string {
  const i = line.indexOf('//');
  if (i === -1) return line;
  return line.slice(0, i);
}
