import { describe, expect, it } from 'vitest';
import { parseSocket } from '../src/cvox/socket.js';

describe('parseSocket', () => {
  it('parses socket without rotation', () => {
    const r = parseSocket(['hat', '1', '3', '1']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('hat');
      expect(r.value.pos).toEqual({ x: 1, y: 3, z: 1 });
      expect(r.value.rot).toBeUndefined();
    }
  });

  it('parses socket with rotation', () => {
    const r = parseSocket(['mouth', '1', '1', '3', 'rot', '0', '90', '0']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('mouth');
      expect(r.value.pos).toEqual({ x: 1, y: 1, z: 3 });
      expect(r.value.rot).toEqual({ x: 0, y: 90, z: 0 });
    }
  });

  it('accepts kebab-case socket name', () => {
    const r = parseSocket(['ear-l', '0.5', '2', '0.5']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('ear-l');
  });

  it('accepts fractional coords', () => {
    const r = parseSocket(['anchor', '1.5', '2.25', '0.5']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pos).toEqual({ x: 1.5, y: 2.25, z: 0.5 });
  });

  it('E06: rejects empty args', () => {
    const r = parseSocket([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects name-only', () => {
    const r = parseSocket(['hat']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects 3 args (name + 2 coords)', () => {
    const r = parseSocket(['hat', '1', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects 5 args without rot keyword', () => {
    const r = parseSocket(['hat', '1', '3', '1', '2']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects unknown keyword in 5th position', () => {
    const r = parseSocket(['hat', '1', '3', '1', 'foo', '0', '90', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects rot with no args', () => {
    const r = parseSocket(['hat', '1', '3', '1', 'rot']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects rot with too few args', () => {
    const r = parseSocket(['hat', '1', '3', '1', 'rot', '0', '90']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects rot with too many args', () => {
    const r = parseSocket(['hat', '1', '3', '1', 'rot', '0', '90', '0', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects invalid socket name', () => {
    const r = parseSocket(['1bad', '1', '3', '1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });

  it('E06: rejects non-numeric coord', () => {
    const r = parseSocket(['hat', 'abc', '3', '1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E06');
  });
});
