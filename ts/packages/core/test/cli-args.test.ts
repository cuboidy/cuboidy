import { describe, expect, it } from 'vitest';
import { parseBackground, parsePositiveInt } from '../src/cli/args.js';

// These were copied into cuboidy-snap and cuboidy-gif separately, and the
// copies drifted from core's own colour reader — which is the reader the
// FORMAT is defined by. Duplication in a flag parser shows up as the same
// option behaving differently depending on which command you typed.

describe('parsePositiveInt', () => {
  it('takes a positive integer', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt('256')).toBe(256);
  });

  it('rejects zero, negatives, and anything not all digits', () => {
    for (const s of ['0', '-1', '1.5', '1e3', '', ' 1', '1 ', '0x10', 'abc']) {
      expect(parsePositiveInt(s), s).toBeNull();
    }
  });
});

describe('parseBackground', () => {
  it('reads every §7.4 hex form', () => {
    expect(parseBackground('#000')).toEqual([0, 0, 0]);
    expect(parseBackground('#FFFFFF')).toEqual([1, 1, 1]);
    // The alpha forms are the ones the hand-rolled parsers rejected, so
    // `--bg=#8a909980` failed on the CLI and parsed everywhere else.
    expect(parseBackground('#8a909980')).toEqual(parseBackground('#8a9099'));
    expect(parseBackground('#8AF8')).toEqual(parseBackground('#88AAFF'));
  });

  it('keeps the leading # optional, as the old CLI parsers did', () => {
    // Not §7.4 — a command line where `#` starts a comment earns the
    // tolerance, and only here.
    expect(parseBackground('888')).toEqual(parseBackground('#888'));
    expect(parseBackground('8a9099')).toEqual(parseBackground('#8a9099'));
  });

  it('rejects anything that is not hex', () => {
    for (const s of ['', '#', 'nothex', '#12345', '#1234567', 'rgb(0,0,0)']) {
      expect(parseBackground(s), s).toBeNull();
    }
  });

  it('is case-insensitive and lands in 0..1', () => {
    expect(parseBackground('#AbCdEf')).toEqual(parseBackground('#abcdef'));
    const c = parseBackground('#808080')!;
    for (const v of c) expect(v).toBeGreaterThan(0.49);
    for (const v of c) expect(v).toBeLessThan(0.51);
  });
});
