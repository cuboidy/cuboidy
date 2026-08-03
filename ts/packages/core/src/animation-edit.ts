// Pure editing toolkit for animation tracks — the data-model half of the
// keyframe editor. Every function is a pure, immutable transform over the
// SPEC structure `AnimationTrack = Record<timeKey, Keyframe>` (animation.ts).
// The editor UI owns React state and writeback; this module owns the
// "what does the track look like after this edit" logic, so it can be unit
// tested without a renderer.
//
// Per-attribute model: an attribute's "track" is the set of time-keys whose
// Keyframe carries that field. Editing one attribute at one time only ever
// touches that field of that time-key entry.

import type { AnimationTrack, Keyframe, Vec3Tuple } from './animation.js';
import type { EasingName } from './easing.js';

export type KeyAttr = 'rot' | 'pos' | 'scale' | 'visible';
export type AttrValue = Vec3Tuple | boolean;
// The attributes that interpolate — the only ones an `ease` entry can name
// (SPEC §6.5; `visible` steps and has none).
export type EaseAttr = Exclude<KeyAttr, 'visible'>;

const ATTR_FIELDS: readonly KeyAttr[] = ['rot', 'pos', 'scale', 'visible'];

// A time-key entry justifies its existence only by carrying at least one
// attribute field. `ease` (SPEC §6.5) is segment metadata, not an attribute:
// an entry left holding ONLY `ease` would render no marker in the editor yet
// still pin every attribute to its carried-over value at that time (resolve
// is dense) — an invisible flattening. So removal paths treat such an entry
// as empty and drop it, letting the ease die with its keyframe.
function hasAttrField(kf: Keyframe): boolean {
  return ATTR_FIELDS.some((a) => a in kf);
}

// Remove `attr` from an entry ALONG WITH its `ease` entry — the easing
// belongs to the attribute (SPEC §6.5), so it never outlives the field. An
// emptied ease map is dropped entirely (never serialize `"ease": {}`).
function withoutAttr(entry: Keyframe, attr: KeyAttr): Keyframe {
  const { [attr]: _drop, ...rest } = entry;
  if (attr === 'visible' || rest.ease?.[attr] === undefined) return rest;
  const { [attr]: _dropEase, ...restEase } = rest.ease;
  const out: Keyframe = { ...rest };
  if (Object.keys(restEase).length === 0) delete out.ease;
  else out.ease = restEase;
  return out;
}

// SPEC §6.5 first-keyframe defaults, by attribute. Used to seed the
// mandatory "0.0" key (§6.6) so a freshly-keyed attribute interpolates from
// rest rather than snapping.
export function restValue(attr: KeyAttr): AttrValue {
  switch (attr) {
    case 'scale':
      return [1, 1, 1];
    case 'visible':
      return true;
    case 'rot':
    case 'pos':
      return [0, 0, 0];
  }
}

// Half-grid tolerance for treating an add as coinciding with an existing key
// (the timeline's finest scrub step is ~duration/200, well above this).
const TIME_EPS = 5e-4;

// Canonical decimal-string time key. Rounds to a 1e-3 grid (so scrubbing
// never mints `0.30000000000000004`), and always includes a decimal point
// so integers read as `"0.0"` / `"1.0"` like the authored fixtures.
// Guarantees `Number(formatTimeKey(t)) === Math.round(t * 1000) / 1000`.
export function formatTimeKey(t: number): string {
  const r = Math.round(t * 1000) / 1000;
  const v = r === 0 ? 0 : r; // normalise -0 → 0
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

// The existing key within `eps` seconds of `t`, or null. Lets an "add key"
// that lands on an existing marker MERGE into it instead of creating a
// near-duplicate float key.
export function nearestExistingKey(
  track: AnimationTrack,
  t: number,
  eps = TIME_EPS,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const k of Object.keys(track)) {
    const kt = Number(k);
    if (!Number.isFinite(kt)) continue;
    const d = Math.abs(kt - t);
    if (d <= eps && d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return best;
}

// Return a copy of the track with keys re-inserted in ascending time order.
// JSON.stringify preserves insertion order, so applying this on every write
// keeps the serialized manifest sorted (matching authored fixtures) even
// when a key is added "in the middle". Non-numeric keys (shouldn't occur)
// sort last, deterministically.
export function sortTrackKeys(track: AnimationTrack): AnimationTrack {
  const keys = Object.keys(track).sort((a, b) => {
    const ta = Number(a);
    const tb = Number(b);
    const na = Number.isFinite(ta) ? ta : Infinity;
    const nb = Number.isFinite(tb) ? tb : Infinity;
    return na - nb;
  });
  const out: AnimationTrack = {};
  for (const k of keys) out[k] = track[k]!;
  return out;
}

// Set one attribute field on a keyframe immutably, preserving the others.
// Typed per-attribute so the value shape matches the field.
function withAttr(entry: Keyframe, attr: KeyAttr, value: AttrValue): Keyframe {
  switch (attr) {
    case 'visible':
      return { ...entry, visible: value as boolean };
    case 'rot':
      return { ...entry, rot: value as Vec3Tuple };
    case 'pos':
      return { ...entry, pos: value as Vec3Tuple };
    case 'scale':
      return { ...entry, scale: value as Vec3Tuple };
  }
}

const ZERO_KEY = formatTimeKey(0); // "0.0"

// SPEC §6.6: every animated part must have a "0.0" key. If the track has no
// "0.0" entry at all, seed one carrying `attr` at its rest value — giving the
// part its mandatory start key and the attribute a from-rest interpolation
// origin. If a "0.0" entry already exists (any fields), leave it: carryover
// already yields rest for an unset attribute there.
function ensureZeroKey(track: AnimationTrack, attr: KeyAttr): AnimationTrack {
  if (track[ZERO_KEY] !== undefined) return track;
  return { ...track, [ZERO_KEY]: withAttr({}, attr, restValue(attr)) };
}

// Overwrite the value of an attribute at an EXISTING time-key. No-op-safe if
// the key is absent (creates it), but the editor only calls this for a key
// the user selected, so the entry is present.
export function setAttrAtKey(
  track: AnimationTrack,
  timeKey: string,
  attr: KeyAttr,
  value: AttrValue,
): AnimationTrack {
  const entry = withAttr(track[timeKey] ?? {}, attr, value);
  return sortTrackKeys({ ...track, [timeKey]: entry });
}

// Add (or merge into) a keyframe for `attr` at time `t`. Coincident adds
// merge into the nearest existing key; otherwise a new key is minted at the
// canonical time. Always ensures the §6.6 "0.0" key. Returns the new track
// plus the resolved time-key (so the caller can select the new marker).
export function addAttrAtTime(
  track: AnimationTrack,
  t: number,
  attr: KeyAttr,
  value: AttrValue,
): { track: AnimationTrack; timeKey: string } {
  const timeKey = nearestExistingKey(track, t) ?? formatTimeKey(t);
  const withKey = { ...track, [timeKey]: withAttr(track[timeKey] ?? {}, attr, value) };
  return { track: sortTrackKeys(ensureZeroKey(withKey, attr)), timeKey };
}

// Remove one attribute field from a time-key (its ease entry goes with it,
// see withoutAttr). Drops the entry entirely if no attribute field remains
// (never serialize `"0.5": {}` — nor an ease-only entry, see hasAttrField).
// If removing it leaves the
// attribute with surviving keys but no "0.0" entry, re-seed "0.0" with the
// attribute's rest value so the part keeps a §6.6 start key and doesn't snap
// at t=0. If the attribute is fully gone, no re-seed (it rests everywhere).
export function deleteAttrAtKey(
  track: AnimationTrack,
  timeKey: string,
  attr: KeyAttr,
): AnimationTrack {
  const entry = track[timeKey];
  if (entry === undefined) return track;
  const rest = withoutAttr(entry, attr);
  const out: AnimationTrack = { ...track };
  if (!hasAttrField(rest)) delete out[timeKey];
  else out[timeKey] = rest;

  if (out[ZERO_KEY] === undefined) {
    const attrSurvives = Object.values(out).some((kf) => attr in kf);
    if (attrSurvives) {
      out[ZERO_KEY] = withAttr({}, attr, restValue(attr));
    }
  }
  return sortTrackKeys(out);
}

// Move one attribute's field from `fromTimeKey` to the key resolved from
// `toTime` (retiming a key by drag). A pure rename: the output's time-keys
// are exactly the input's with from→to renamed — no §6.6 "0.0" re-seed side
// effect (which is why the removal is inlined rather than composed from
// deleteAttrAtKey; on a malformed track lacking "0.0" a move must not mint
// one). The editor never drags the "0.0" key (SPEC §6.6 lock); the guard
// here is defensive.
//
// Target resolution matches addAttrAtTime: a `toTime` within eps of an
// existing key merges into that entry (legitimate for cross-attribute
// landings). Landing on a key that already carries `attr` overwrites that
// field — the UI blocks same-attribute collisions; this helper stays
// mechanical like setAttrAtKey.
//
// The moved attribute's `ease` entry travels with it (SPEC §6.5: easing is
// per-attribute) — a drag must not silently drop the segment's curve. It
// overwrites the target's entry for that attribute, exactly like the value
// does; the source's OTHER ease entries stay with their attributes.
//
// Returns the (possibly unchanged) track plus the resolved time-key so the
// caller can keep the moved key selected.
export function moveAttrKey(
  track: AnimationTrack,
  fromTimeKey: string,
  toTime: number,
  attr: KeyAttr,
): { track: AnimationTrack; timeKey: string } {
  const entry = track[fromTimeKey];
  if (entry === undefined || !(attr in entry) || fromTimeKey === ZERO_KEY) {
    return { track, timeKey: fromTimeKey };
  }
  const toKey = nearestExistingKey(track, toTime) ?? formatTimeKey(toTime);
  if (toKey === fromTimeKey) return { track, timeKey: fromTimeKey };

  const value = entry[attr] as AttrValue;
  const movedEase = attr !== 'visible' ? entry.ease?.[attr] : undefined;
  const rest = withoutAttr(entry, attr);
  const out: AnimationTrack = { ...track };
  if (!hasAttrField(rest)) delete out[fromTimeKey];
  else out[fromTimeKey] = rest;
  let target = withAttr(out[toKey] ?? {}, attr, value);
  if (movedEase !== undefined && attr !== 'visible') {
    target = { ...target, ease: { ...target.ease, [attr]: movedEase } };
  }
  out[toKey] = target;
  return { track: sortTrackKeys(out), timeKey: toKey };
}

// Paste helper: field-wise merge of `kf` into the entry at (or minted at)
// `t` — the data-model half of keyframe copy/paste. Present fields
// overwrite the target's; absent fields leave it untouched (carryover holes
// stay holes). Composed from addAttrAtTime per attribute so the §6.6 "0.0"
// seed and nearest-key merge rules hold; each pasted attribute also brings
// its own ease entry when the source has one (an absent source ease never
// clears the target's). Returns the resolved time-key so the caller can
// select the pasted key; an attribute-less `kf` is a no-op (input reference
// returned).
export function mergeKeyframeAtTime(
  track: AnimationTrack,
  t: number,
  kf: Keyframe,
): { track: AnimationTrack; timeKey: string } {
  let out = track;
  let timeKey = nearestExistingKey(track, t) ?? formatTimeKey(t);
  for (const attr of ATTR_FIELDS) {
    const value = kf[attr];
    if (value === undefined) continue;
    const r = addAttrAtTime(out, t, attr, value);
    out = r.track;
    timeKey = r.timeKey;
    if (attr !== 'visible') {
      const ease = kf.ease?.[attr];
      if (ease !== undefined) out = setEaseAtKey(out, timeKey, attr, ease);
    }
  }
  return { track: out, timeKey };
}

// Set or clear one attribute's `ease` entry (SPEC §6.5) at an EXISTING
// time-key. `undefined` removes the entry — the segment reverts to linear —
// dropping an emptied ease map entirely (never serialize `"ease": {}`).
// No-op (input reference returned) when the entry is absent — minting an
// attr-less entry here would create an invisible flattening key (see
// hasAttrField) — or when the value already matches.
export function setEaseAtKey(
  track: AnimationTrack,
  timeKey: string,
  attr: EaseAttr,
  ease: EasingName | undefined,
): AnimationTrack {
  const entry = track[timeKey];
  if (entry === undefined || entry.ease?.[attr] === ease) return track;
  if (ease === undefined) {
    const { [attr]: _drop, ...restEase } = entry.ease ?? {};
    const next: Keyframe = { ...entry };
    if (Object.keys(restEase).length === 0) delete next.ease;
    else next.ease = restEase;
    return { ...track, [timeKey]: next };
  }
  return {
    ...track,
    [timeKey]: { ...entry, ease: { ...entry.ease, [attr]: ease } },
  };
}

// Drop every time-key entry beyond `duration` (cleanup after the user
// shortened a clip). Strict `>`: a key exactly at duration is legal per SPEC
// §6.6 (and is the loop's wrap end value), so it survives. "0.0" is
// structurally safe (0 > duration is false for any non-negative duration).
// Returns the INPUT REFERENCE unchanged when nothing is out of range, so
// callers can cheaply detect a no-op.
export function trimTrackKeys(
  track: AnimationTrack,
  duration: number,
): AnimationTrack {
  const over = Object.keys(track).filter((k) => Number(k) > duration);
  if (over.length === 0) return track;
  const out: AnimationTrack = { ...track };
  for (const k of over) delete out[k];
  return out;
}

// ── retiming ─────────────────────────────────────────────────────────

// One step of the canonical time grid (formatTimeKey rounds to 1e-3).
// Neighbor clamps keep a full grid step of clearance, which strictly
// exceeds nearestExistingKey's eps (5e-4), so a clamped retime can never
// silently merge into a same-attribute neighbor.
const GRID = 0.001;

const snapMs = (t: number): number => Math.round(t * 1000) / 1000;

// The legal window for retiming a key whose same-attribute neighbors sit
// at prevT / nextT (null at the lane's edges): one grid step clear of
// each neighbor, inside the grid-aligned duration. Null = degenerate gap
// — the caller pins to the original time. No prev neighbor → 0 is
// allowed: landing on a "0.0" entry that does not carry this attribute
// is a legitimate cross-attr merge.
export function retimeWindow(
  duration: number,
  prevT: number | null,
  nextT: number | null,
): { min: number; max: number } | null {
  const durGrid = Math.floor(duration * 1000) / 1000;
  const min = prevT !== null ? snapMs(prevT + GRID) : 0;
  const max = Math.min(nextT !== null ? snapMs(nextT - GRID) : durGrid, durGrid);
  return min > max ? null : { min, max };
}

// Clamp a retime request to its legal window, deriving the neighbors
// from the track. The marker drag and the inspector's numeric time field
// both come through this rule, so they cannot disagree about whether a
// move is legal. Null when the track / duration cannot host the move.
export function clampRetime(
  track: AnimationTrack | undefined,
  attr: KeyAttr,
  fromTimeKey: string,
  toTime: number,
  duration: number,
): number | null {
  if (track === undefined || duration <= 0) return null;
  const fromT = Number(fromTimeKey);
  const times = Object.keys(track)
    .filter((k) => attr in track[k]!)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const i = times.indexOf(fromT);
  const prev = i > 0 ? times[i - 1]! : null;
  const next = i >= 0 && i < times.length - 1 ? times[i + 1]! : null;
  const window = retimeWindow(duration, prev, next);
  if (window === null) return null;
  const snapped = snapMs(toTime);
  return Math.min(Math.max(snapped, window.min), window.max);
}
