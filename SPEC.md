# Cuboidy Format Specification

**Version:** 0.9 (draft)
**Status:** Early draft. Subject to change before v1.0.

**Revision history:** [CHANGELOG.md](CHANGELOG.md). v0.9 changed the geometry
container to JSON, moved palette ownership into the geometry file, and added a
per-part rest rotation; read it before porting a pre-v0.9 model.

---

## 1. Overview

Cuboidy is an open JSON file format for voxel character models with rigged parts, named attachment sockets, and shareable keyframe animations.

Design goals:

- **Human-readable** — diff-friendly, editable in any text editor
- **AI-authorable** — structure favors generation reliability over byte efficiency
- **Browser-editable** — no proprietary binary, no native dependencies
- **Self-contained** — references resolve via filesystem only; no registry, no namespace URIs

Cuboidy draws on prior art:

- **Minecraft Bedrock** geometry / animation — rigid part hierarchy, per-part pivot
- **Mixamo** clips — cross-rig animation reuse via part-name binding
- **MagicaVoxel** — voxel grid + inline palette
- **VRM** — named attachment points (planned: standardized rig vocabulary)
- **glTF** — JSON manifest + relative external references

Cuboidy is **not** a triangle-mesh format. It does not specify skin weights, UV coordinates, textures, or shaders. Voxel parts are rigid. A palette color carries a simple surface material (§7.4 — metal, roughness, glow) and nothing beyond it.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Cuboidy format** | The spec defined by this document |
| **Cuboidy model** (or **package**) | A single asset, stored as a folder |
| **Manifest** | `cuboidy.json` — the package's required, fixed-name anchor: rig hierarchy, animations, and each part's geometry (a reference, or written inline) |
| **Geometry file** | A JSON file (§7) — shape, optional inline palette, pivot, sockets. Default (when the manifest lists none): `voxels.json` |
| **Inline geometry** | A part's shape written into the manifest instead of a file (§6.13). A model whose every part is inline is a single text file |
| **Palette file** | A `.json` file of shareable colors (§6.10), referenced by each geometry file that uses them (§7.4) |
| **Packed Cuboidy** | `<name>.cuboidy` — the package folder as a single ZIP archive (§13) |
| **Part** | A rigid voxel sub-object, optionally parented in the hierarchy |
| **Socket** | A named attachment point on a part, declared in the geometry file (§7.8) |
| **Published socket** | A socket the manifest offers to consumers under a model-level name (§6.12). An unpublished socket is internal |
| **Keyframe** | A time-indexed pose snapshot for an animated part |
| **Rest pose** | A part's pose when no animation is active: position = `part.position` (in parent space), rotation = the manifest part's `rotation` composed with the geometry file's `pivot.rot` (`q_rotation · q_pivot`, both around `pivot.pos`; each identity when absent), scale = the manifest part's `scale` (around `pivot.pos`; `[1,1,1]` when absent) |

---

## 3. Folder structure

A Cuboidy model is stored as a folder. The folder's name is conventional and not authoritative; the manifest's `name` field is.

`cuboidy.json` is the package's **only fixed filename** — the deterministic entry point a loader looks for (the same role `.gltf` or `package.json` play). Every other file is named freely and found by reference from the manifest (§8): geometry files via `geometry` (§6.9) and per-part `geometry.path` (§6.13), a shared palette via `palette` (§6.10 / §6.13), external animations via `animations` string values (§6.3).

It is also **required**. A directory with no `cuboidy.json` is not a model, whatever else it contains: a lone `voxels.json` has shape but no rig, no animations and no name, so there is nothing to load it *as*. A reader MUST report its absence as `missing` rather than inferring a model from the files it finds. (Some tools in this repository used to accept a bare geometry file as a shape preview. That was never in this specification, and §6.13's inline form now covers the case it served — one file, complete model.)

```
my-model/
├── cuboidy.json         required — manifest (the anchor)
├── voxels.json          geometry — the default when `geometry` is absent
└── anims/               optional — shared / external animation files
    ├── walk.json
    └── idle.json
```

At the small end, a model can be a **single file**: put every part's shape inline (§6.13) and there is nothing left to reference.

```
tiny-model/
└── cuboidy.json         manifest + all geometry inline — the whole model
```

This is the one-text-file form. `<name>.cuboidy` (§13) also packs a model into one file, but as a ZIP; an all-inline `cuboidy.json` stays diffable, pasteable and editable in any text editor, which is what §1 asks of the format.

A larger package, fully reference-driven:

```
knight/
├── cuboidy.json         { "geometry": ["body.json", "arms.json"], ... }
├── palette.json         shared palette (§6.10)
├── body.json            geometry — { "palette": "palette.json", ... }
├── arms.json            geometry — points at the same palette
└── anims/walk.json
```

Files not referenced from the manifest (other than `cuboidy.json` itself) are **ignored** — they are not part of the model. An unreferenced geometry file additionally lints as **W07** (§11.6), since it is usually a forgotten `geometry` entry. The `anims/` subfolder is conventional; referenced files may live anywhere in the package.

---

## 4. Coordinate system

Cuboidy uses a **right-handed coordinate system**:

- **+X**: model's right
- **+Y**: up
- **−Z**: forward (the direction the model faces)

This matches glTF, USD, Blender, and Three.js. Unity-based consumers negate the Z axis on load.

Rotations are **Euler angles in degrees**, applied in **ZXY intrinsic order**. Positive rotation follows the right-hand rule around each positive axis: looking along the positive axis toward the origin, positive angles rotate counter-clockwise. The Unity Inspector uses the same ZXY intrinsic order, but Unity consumers MUST still convert handedness by negating Z-space as noted above.

All coordinates are in **voxel units**. Fractional values are allowed everywhere (positions, pivots, rotations, scale, time). Voxels are not required to align on integer boundaries.

Numbers are interpreted as **IEEE 754 double precision** floating point. Integer literals and decimal literals are interchangeable in any numeric field.

---

## 5. Identifiers

Names for parts, sockets, animations, and the model itself match:

```
[a-zA-Z_][a-zA-Z0-9_-]*
```

- Case-sensitive
- ASCII only (no Unicode)
- Hyphen `-` allowed (`leg-fl`, `ear-l`)
- No leading digit or hyphen
- **Must not match a reserved keyword** — `palette`, `part`, `size`, `pivot`, `socket`, `voxels`, `rot` are not valid identifiers, even though they satisfy the regex above

The reserved-keyword exclusion is inherited from the text container that
preceded JSON, where a bare `part part` would otherwise have been ambiguous.
JSON has no such ambiguity, so the rule is no longer load-bearing —
it is kept because it costs nothing, no existing model uses those names, and
lifting it would be a separate breaking change to a rule that `cuboidy.json`
and `voxels.json` currently share. Both files apply it identically: names are
plain JSON strings validated by the same `isIdentifier`, so any name valid in
one is valid in the other.

Uniqueness scopes:

- Part names: unique within a model
- Socket names: unique within a part
- Animation names: unique within a model

---

## 6. `cuboidy.json` — manifest

The manifest is a standard JSON document (no comments, no trailing commas).

### 6.1 Top-level shape

```json
{
  "name": "<identifier>",
  "version": "0.9",
  "geometry": ["body.json", "gear/hat.json"],
  "palette": "palette.json",
  "parts": [ ... ],
  "sockets": { ... },
  "animations": { ... }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Model identifier |
| `version` | no | string | Spec version this model targets. Absent → the current spec version (`"0.9"` in this draft) |
| `geometry` | no | array of reference paths | The model's geometry **files** (§6.9), for parts that do not carry their own geometry. Absent → `["voxels.json"]` |
| `palette` | no | array of colors, or a reference path | The palette **inline part geometry** uses when it declares none of its own (§6.13). It never applies to a part whose geometry lives in a file — see the scoping rule in §6.13 |
| `parts` | **yes** | array (non-empty) | At least one part |
| `sockets` | no | object | The model's **published sockets** (§6.12) — the attachment points it offers to consumers. Absent → the model publishes none |
| `animations` | no | object | Map from animation name to definition. Absent → no animations |

### 6.2 Part object

```json
{
  "name": "<identifier>",
  "parent": "<identifier>",
  "position": [x, y, z],
  "rotation": [rx, ry, rz],
  "scale": [sx, sy, sz],
  "geometry": { … }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Unique within model |
| `geometry` | no | object | Where this part's shape comes from — a file, or written out here (§6.13). Absent → looked up by `name` among the files in the top-level `geometry` list |
| `parent` | no | string (identifier) | Another part's name. Absent → this part is a root |
| `position` | no | `[number, number, number]` | Where this part's pivot sits in **parent space** — voxel-unit offset from the parent's pivot (root parts: offset from world origin). Default `[0, 0, 0]` (this part's pivot coincides with the parent's pivot). See §7.7 for the full transform semantics |
| `rotation` | no | `[number, number, number]` | The part's **rest rotation** in parent space: Euler degrees, ZXY intrinsic order (§4), applied around the part's pivot. Composes outside the geometry file's `pivot.rot` (`q_rest = q_rotation · q_pivot`, §7.7) and is inherited by children like any parent transform. Default: absent → identity |
| `scale` | no | `[number, number, number]` | The part's **rest scale**: per-axis multipliers on its voxels, applied around the part's pivot. Every value MUST be `> 0` (zero, negative and non-finite are `invalid-value`); non-uniform is allowed. Multiplies with the keyframe `scale` of §6.5 — same axis, same pivot, same non-inheritance — so `S_total = scale ⊙ anim.scale`. Default: absent → `[1, 1, 1]` |

Rules:

- Multiple root parts (parts with no `parent`) are permitted.
- The `parts` array may be in any order; the parser resolves the hierarchy in a second pass.
- `parent` must refer to another part in the same model.
- A part MUST NOT name itself as its parent; this is a one-node cycle.
- Cycles in the parent chain are an error.

**Parent space is pivot-centered, not voxel-grid-centered.** A child's `position` is interpreted relative to the parent's *pivot*, not the corner of the parent's voxel grid. Moving a parent's pivot (e.g. by editing `pivot` in `voxels.json`) does **not** shift the children — the parent's voxels translate relative to the pivot, and the children stay attached at their pivot-relative offsets. This is the standard rig convention shared with glTF, Mixamo, and Minecraft Bedrock geometry.

Per-part shape, pivot, and sockets live in `voxels.json`, not here. See §7.

### 6.3 Animation map

```json
"animations": {
  "<name>": <animation>,
  ...
}
```

`<animation>` is either:

- An inline **object** (see §6.4)
- A **string** — relative path to a JSON file containing one animation object (see §8)

### 6.4 Inline animation object

```json
{
  "duration": <number>,
  "loop": <bool>,
  "parts": {
    "<part-name>": {
      "<time-key>": { "rot": [...], "pos": [...], "scale": [...], "visible": ..., "ease": { "rot": "..." } },
      ...
    },
    ...
  }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `duration` | **yes** | number | Animation length in seconds. Must be ≥ the largest time key |
| `loop` | **yes** | bool | If `true`, sampling wraps after `duration`; see §6.7 |
| `parts` | **yes** | object | Map from part name to keyframe sequence. May be empty (no part animates). Each key is a **part name**, so it obeys §5 like every other name in the format — a key that could not be a part name is `invalid-value` (§11.5). §6.8 separately permits a key that IS a legal name but matches no part in this model |

### 6.5 Keyframe values

| Field | Type | Interpretation | Default at first keyframe |
|---|---|---|---|
| `rot` | `[rx, ry, rz]` Euler degrees | **Relative** to rest pose rotation (the manifest part's `rotation` composed with the part's `pivot.rot`; identity when both are absent). Composed as described in §7.7 | `[0, 0, 0]` |
| `pos` | `[dx, dy, dz]` voxel units | **Delta** added to `part.position`, and therefore in the same frame — parent space. It rides the ancestors' rest rotations exactly as `position` does, and is **not** turned by the part's own `rotation` or `pivot.rot` (§7.7 places it outside `M_rot`) | `[0, 0, 0]` |
| `scale` | `[sx, sy, sz]` multipliers | **Multiplier** from the part's rest scale (§6.2 `scale`, itself `[1,1,1]` when absent). Per-axis, non-uniform allowed. Applied around the same pivot point as `rot`, and like the rest scale it does not reach the part's children | `[1, 1, 1]` |
| `visible` | bool | Visibility toggle | `true` |
| `ease` | object | Map from attribute name (`rot` / `pos` / `scale`) to a named easing preset for that attribute's **outgoing** segment (this keyframe → the next); see §6.7. `visible` always steps and is not a valid key | `{}` (every attribute `linear`) |

#### Carryover

In a part's keyframe sequence, **any value field omitted from a keyframe inherits its value from the previous keyframe** for that part. The first keyframe's defaults are listed above.

**`ease` is exempt from carryover.** An omitted `ease` (or an attribute missing from the map) means **linear** for that keyframe's outgoing segment — easing applies only where it is written and never propagates to later keyframes. (Rationale: easing describes one segment's shape, not part state; inheriting it would let a curve set on one key silently reshape unrelated segments.)

Example:

```json
"tail": {
  "0.0": { "rot": [0,  0, 0] },
  "0.5": { "rot": [0, 25, 0] },
  "1.0": { "rot": [0,  0, 0] }
}
```

Here `pos`, `scale`, and `visible` are constant across all keyframes (`[0,0,0]`, `[1,1,1]`, `true`) because they are never specified.

### 6.6 Time keys

- Format: JSON string of a decimal number, **with the decimal point
  required** — `"0.0"`, `"0.5"`, `"1.25"`. Formally `^[0-9]+\.[0-9]+$`, so
  `"1"` is not a time key and `"1.0"` is. This also excludes the other
  spellings a language's number parser may accept: `"0x10"`, `"0b11"`,
  `"1e3"`, `"5."`, `"+1"`, `" 1.0"`
- Unit: seconds (IEEE 754 double precision)
- Must start at `"0.0"` for every animated part
- Must be strictly increasing across the sequence for a given part
- Maximum time key must be ≤ `duration`

The point is required because a JSON object key that spells a canonical
non-negative integer is not an ordinary string key in every language's object
model. JavaScript hoists such keys ahead of the rest, so
`{"0.0": …, "0.5": …, "1": …}` is read back in the order `"1"`, `"0.0"`,
`"0.5"` and the ordering rule above rejects a document written in order,
while a reader over an order-preserving parser accepts it. Requiring the
point keeps every legal time key an ordinary string key, so implementations
agree on which documents are valid rather than on which object model they
were parsed with.

### 6.7 Interpolation

Between consecutive keyframes:

- `rot`, `pos`, `scale` interpolate along the segment's **easing curve** (below); with the default `linear` ease this is plain linear interpolation
- **Interpolation is component-wise on the stored triple.** For `rot` this means the three Euler angles are interpolated independently — *not* converted to quaternions and slerped. The two agree for small rotations and diverge as they grow, so this is a conformance requirement, not an implementation detail. It is also what makes a full revolution expressible: a segment from `0` to `−360` on one axis is a constant-rate turn under component-wise interpolation, where a slerp would treat the endpoints as the same orientation and produce no motion at all.
- **The interpolation is `a·(1 − u′) + b·u′`**, not `a + (b − a)·u′`. The two are algebraically the same and are not the same in floating point: the second is exact at `u′ = 0` and not at `u′ = 1`, so a keyframe's own value does not survive being sampled at its own time. Measured across this repository's models, it lost 36 of 3411 keyed components — `fox/trot` keys a body offset of `-0.02` and read back `-0.01999999999999999`. The first form is exact at both ends. This is the one place the spec names an arithmetic form, and it is named because the guarantee below depends on it.
- `visible` uses **step** interpolation: the value at the later keyframe takes effect at that keyframe's time
- **A sample time within a small tolerance of a keyframe is AT that keyframe**, and the same tolerance applies to every attribute. This is not a nicety. Wrapping is the exact IEEE remainder, and that is not the arithmetic one, because the dividend is not the number the author wrote: the double nearest `12.7` is `12.699999999999999289…`, so its remainder in a 6-second loop is `0.6999999999999993` and no formula recovers `0.7`. Compared exactly, the interpolating attributes then sit at `u = 0.99999999999999905` — at the keyframe for any purpose — while a step attribute reads "not yet", and the two disagree about the same instant. Snap once, before any attribute is read, so all four answer the same question.

  The tolerance is `min(max(|time|, duration) × 1e-12, g / 1000)`, where `g` is the smallest interval between adjacent keyframes in the track (unbounded for a single-keyframe track), and a tie goes to the earlier keyframe. It scales with the clock because the error does, and it is **bounded relative to the closest pair of keys because that scaling is not**: at a clock of `1e9` against keys 1 ms apart, the unscaled form is a whole key spacing wide, so every sample snaps to a key and the part stops moving.

  The bound is a thousandth of a gap and not, as it may look, half of one. Half is the largest tolerance that cannot reach a *non-nearest* key — but half-gap intervals centred on the keys **tile the timeline**, so at that bound every sample is within tolerance of something and interpolation disappears exactly as completely. A thousandth leaves 99.8% of every segment interpolating and still exceeds the wrap error by three orders at any clock below roughly `4e9` seconds.

  Past that the sample time has lost the precision to name a keyframe, and no tolerance recovers it without destroying the interpolation it protects. That is a property of the double, not a choice to be made; an implementation should not widen the tolerance in the hope of it.

- **A non-finite sample time has no position in a clip.** `NaN` samples as `0`. For `loop: false`, `±Infinity` clamps to an end like any other out-of-range time; for `loop: true` there is no end to clamp to and the wrap of an infinity is undefined, so it too samples as `0`. Stated because the alternative is not a different answer but a different failure per host: a language that reads past the end of an array returns a pose of `NaN`s that propagates through the whole rig, and one that raises throws — and which of the two happens depended on how many keyframes the track had.

#### Easing

Each attribute's curve over a segment is named by the `ease` map of the segment's **outgoing** keyframe (the earlier of the pair): `"ease": { "rot": "out-elastic" }` shapes **only** `rot`, **only** across the segment leaving that keyframe. There is no carryover (§6.5) and no cross-attribute effect — an attribute absent from the map interpolates linearly, so a curve can never leak onto later segments or onto other attributes that happen to cross the same span. To ease several consecutive segments, name the curve on each of their outgoing keyframes.

An easing is a pure remap `u → u'` of normalized segment progress (`u = 0` at the outgoing keyframe, `u = 1` at the next), applied before linear interpolation of that attribute's values. Every preset maps `0 → 0` and `1 → 1`, so keyed values are always hit exactly at their keyframes — and *exactly* is meant literally: implementations MUST return `0` and `1` for those inputs rather than whatever the formula evaluates to. Five of the twenty land a rounding step away: `in-sine(1)` is `0.9999999999999999`, `in-back(1)` is `0.9999999999999998`, `out-back(0)` is `2.220446049250313e-16`, and `in-out-sine(0)` and `in-out-back(0)` are both `-0`.

Clamping the easing is necessary for that guarantee and not sufficient: an exact `u′` of `0` or `1` still has to pass through the interpolation, which is why the form is pinned above. Both halves, or neither works.

Interior values are **not** normalized: they are what the formulas produce. Evaluate the expressions as written rather than an algebraically equivalent rearrangement, which is what keeps two implementations close — but do not read that as bit-exactness. Eleven of the presets go through `sin`, `cos` or `pow`, which neither ECMAScript nor .NET requires to be correctly rounded, so the last bits are a property of the host maths library and not of this format. Cross-implementation comparison of interior values is to a tolerance; only the endpoints are exact.

The presets and their formulas follow the de-facto standard set popularized by easings.net:

| Preset | Variants | Character |
|---|---|---|
| `linear` | — | Constant rate (default) |
| `step` | — | Holds the outgoing value across the whole interval; the next keyframe's value lands at its time (same rule as `visible`) |
| `sine` | `in-sine`, `out-sine`, `in-out-sine` | Gentle |
| `quad` | `in-quad`, `out-quad`, `in-out-quad` | Moderate |
| `cubic` | `in-cubic`, `out-cubic`, `in-out-cubic` | Strong |
| `back` | `in-back`, `out-back`, `in-out-back` | Overshoots past the target, then settles |
| `elastic` | `in-elastic`, `out-elastic`, `in-out-elastic` | Springy oscillation |
| `bounce` | `in-bounce`, `out-bounce`, `in-out-bounce` | Bounces like a dropped ball |

`back` and `elastic` produce `u'` values outside `[0, 1]`; the interpolation simply extrapolates beyond the segment's endpoint values. An unknown preset name, or an `ease` key other than `rot` / `pos` / `scale`, is a **parse error** (both are closed enums, like the keyframe field names themselves).

Sampling outside the explicitly keyed intervals is defined as follows:

- For `loop: false`, values after the last keyframe are held until `duration`; sampling after `duration` clamps to `duration`
- For `loop: true`, sampling time wraps modulo `duration`
- If `loop: true` and a part's last keyframe time is less than `duration`, the interval from that last keyframe to `duration` interpolates toward the `"0.0"` keyframe, along the **last keyframe's** per-attribute ease (it is that segment's outgoing keyframe)
- If `loop: true` and a part has a keyframe exactly at `duration`, that keyframe is the end value of the final interval before wrap; authors SHOULD make it **equivalent** to `"0.0"` for a continuous loop. Sampling exactly at `duration` is equivalent to sampling at `"0.0"`

  Equivalent, not numerically equal. For an oscillation the two are the same thing. For a **revolution** they are not: a part making one full turn per loop must key `duration` at `0.0 ± 360` (or any whole multiple), which is the same orientation reached by a complete turn. Keying it back to the literal `"0.0"` value instead makes the last segment unwind everything the earlier ones did. Neither lint nor a rest-pose render can see this, so it is worth checking by sampling.

  The two rules above do not conflict, but they do leave a gap the author owns: the `duration` keyframe is the **limit** the final interval approaches, while the value **at** `duration` is the `"0.0"` value. If the two differ, sampling shows exactly that — approaching one value and then jumping to the other. It is a discontinuity you authored, not an ambiguity in the rules.

Custom easing curves (cubic-bezier control points) are reserved for future spec versions.

### 6.8 Missing parts

If an animation's `parts` includes a name that does not exist in this model, the reference is **silently skipped at runtime** (with a warning at lint time).

This rule supports cross-rig sharing: a shared `quadruped_walk.json` that animates `leg-fl, leg-fr, leg-bl, leg-br` works on a 3-legged variant; the missing leg simply does nothing.

### 6.9 Geometry list

```json
"geometry": ["body.json", "gear/hat.json"]
```

- An array of **reference paths** (§8), each ending in `.json`. Non-empty; duplicate entries are `invalid-value`.
- Absent → **`["voxels.json"]`** (the pre-v0.7 fixed layout; existing models are unchanged).
- The list — default included — is consulted **only when some part needs the by-`name` lookup** (§6.13). A manifest in which every part carries its own `geometry` never reads it, so an all-inline single-file model is complete on its own and the absence of `voxels.json` beside it is not an error. Readers MUST NOT demand the default file from a model that does not use it.
- These are the files searched when a part has no `geometry` of its own (§6.13) — the by-`name` lookup. **Part names are unique across the whole model** (§5), which is what makes that lookup unambiguous; a name defined in two listed files is a cross-file `duplicate` error (§11.6).
- A part-level `geometry.path` (§6.13) does **not** have to appear here. An all-explicit model needs no `geometry` list at all, and a model with no name-lookup parts may omit it entirely.
- A geometry file present in the package and referenced by **neither** this list nor any part's `geometry.path` is not part of the model, and lints as **W07** (§11.6).

### 6.10 External palette file

A geometry file may keep its colors in a separate file and point at it, so several geometry files can share one palette (§7.4):

```json
"palette": "palette.json"
```

- A **reference path** (§8) ending in `.json`. Written by whoever owns the colors: a geometry file (§7.4), an inline part, or the manifest as the default for inline parts (§6.13). Each decides for itself; two of them sharing a palette simply name the same path. What no one does is write a palette for *someone else's* file — that is the precedence rule v0.7 had and v0.9 removed.
- Swapping a palette file recolors every geometry file pointing at it (skins).
- The referenced file's colors are the referring file's palette outright — there is no inline palette underneath to override, because `palette` is one field with two forms.
- A geometry file whose voxels use color indices while it declares **no** palette in either form is a cross-file `missing` error, as is one whose reference does not resolve.

The palette file itself is a standard JSON document:

```json
{ "colors": ["#1a1a1a", { "color": "#f4c9a0", "metallic": 1 }, "#RRGGBBAA"] }
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `colors` | **yes** | array of palette entries (non-empty) | Exactly §7.4's entry grammar: a color string (`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`, sRGB) **or** the object form carrying a material. Maximum **64** entries; index assignment is positional and identical to §7.4 (`0-9a-zA-Z$%`) |

No other fields are permitted (`unknown`). The object form (rather than a bare array) reserves room for future metadata without a breaking change.

### 6.11 Concurrency

A model may have at most **one active animation** at a time. Blending, layering, and per-part overlays are reserved for future spec versions.

### 6.12 Published sockets

A part declares sockets in its geometry file (§7.8). Those declarations are **internal**: they say where the attachment frames are, not which of them the model offers to anyone else. The manifest's optional `sockets` object publishes a subset of them under model-level names:

```json
"sockets": {
  "weapon": { "part": "hand-r", "socket": "grip" },
  "crest":  { "part": "head",   "socket": "crest" }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| *key* | — | string (identifier) | The **published name** — how consumers refer to this attachment point. Unique across the model (JSON object keys) |
| `part` | **yes** | string (identifier) | A part in this manifest's `parts` |
| `socket` | **yes** | string (identifier) | A socket declared on that part in geometry (§7.8) |

No other fields are permitted (`unknown`). Publishing carries no offset of its own: a published name is an **alias** for a declared socket, and the frame is exactly the one §7.8 defines. Per-attachment offsets remain reserved (§14).

Rules and rationale:

- **Publication is what makes a socket addressable from outside.** Without it a consumer has to read the geometry files to discover that `hand-r` has a socket called `grip` — reaching past the manifest, which is otherwise the package's whole public surface (`geometry`, `animations` and the rig are all declared there). An unpublished socket is a private detail; the model may move, rename or drop it.
- **Published names are stable across internal renames.** Renaming the part `hand-r` to `hand_right`, or the socket `grip` to `hold`, is invisible to consumers as long as `weapon` keeps pointing at whatever the part and socket are now called.
- **Published names are unique model-wide.** §5 only requires a socket name to be unique *within its part*, so two parts may each declare `tip`; as object keys, published names cannot collide.
- The same declared socket MAY be published under more than one name. A model MAY publish none — `sockets` is optional, and absent means it offers no attachment points.

**Attachment geometry.** When a consumer attaches a guest model to a published socket, the guest is placed so that the guest's **model origin** — world `[0, 0, 0]` in the guest's own coordinate space, before any part transform — coincides with the socket origin, and the guest's axes are rotated by the socket's orientation. Not the guest's root pivot: §6.2 permits multiple root parts, so "the root pivot" is not always a single point, while the origin always is. A model intended to be attached should therefore be authored around its origin, which is where the joining surface goes.

**What is not here.** The manifest publishes attachment points; it does not record attachments. Nothing in a Cuboidy package says that a particular sword is in the knight's hand. Composing several models is a scene-level concern that belongs to a layer above this format — see §14.

### 6.13 Part geometry

A part's rig (`parent`, `position`, `rotation`) lives in the manifest. Its shape — `size`, `pivot`, `sockets`, `voxels` — is a §7 part object, and the part's optional `geometry` object says **where that object is**, in one of two forms.

**Reference form** — the shape is a part in a geometry file:

```json
{ "name": "head", "parent": "neck", "geometry": { "path": "voxels.json" } }
{ "name": "cap",  "parent": "head", "geometry": { "path": "gear/caps.json", "part": "beret" } }
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `path` | **yes** | reference path (§8), `.json` | The geometry file |
| `part` | no | string (identifier) | Which part of that file. Absent → **the enclosing part's `name`** |

**Inline form** — the shape is written here:

```json
{
  "name": "foreleg-l", "parent": "body", "position": [-3, -1, -5],
  "geometry": {
    "size": [3, 10, 4],
    "pivot": { "pos": [1, 10, 2] },
    "voxels": [ … ]
  }
}
```

The inline object is **exactly a §7.5 part object with `name` removed**, plus an optional `palette` (§7.4, either form). `size` and `voxels` are required; `pivot` and `sockets` follow §7.7 and §7.8 unchanged. The name is the enclosing part's `name` — carrying a second copy here would be one field that can disagree with another, so it is not permitted (`unknown`).

`part` is likewise a reference-form field and `unknown` here, for the same reason read from the other side: it names which part of the file at `path` to bind, and inline there is no file to name. Written without `path` it is the authoring slip it looks like — the part named, the file forgotten — so it is reported rather than ignored.

The presence of `path` decides the form. `path` together with any inline field, or an inline object missing `size` or `voxels`, is an error.

**Absent `geometry`** → the by-`name` lookup this format has always used: the part's shape is the part of the same `name` found among the files in the top-level `geometry` list (§6.9). Every model written before this revision keeps working unchanged, and a model may mix all three — some parts referenced, some inline, some left to name lookup.

Why the reference is an object rather than a `file.json#part` string: §8's path grammar would read `voxels.json/head` as a file inside a directory, and a fragment would be a second grammar layered on the first. Two named fields need neither, and this format prefers structure that is reliable to generate over notation that is short (§1).

**Palette scoping.** Where an inline part's colors come from:

1. The inline object's own `palette`, if it has one.
2. Otherwise the manifest's top-level `palette` (§6.1).
3. Otherwise the part has no palette — using any color index is a `missing` error (§11.6).

A part in the **reference form is never affected by the manifest's `palette`**: its colors are its geometry file's, per §7.4. This is the rule that keeps v0.7's mistake from returning. What v0.9 removed was a manifest palette that *overrode* a geometry file's, so a self-contained file's indices meant different things depending on who loaded it. The palette here reaches only geometry the manifest itself contains, where there is no other declaration to shadow: each part resolves to exactly one palette, decided by which fields are present in the object being read.

A top-level `palette` that no inline part ends up using is dead weight and lints as **W08** (§11.6) — most often a v0.7 manifest binding, which meant something else.

---

## 7. `voxels.json` — voxel definition

A JSON file. It declares an optional palette and one or more parts; each part
carries its size, pivot, sockets, and voxel grid. Validated by the JSON Schema
at `schema/cuboidy-geometry.schema.json` plus the cross-field rules below.

> **Retired subsections.** §7.2 (grammar), §7.3 (reserved tokens) and §7.11
> (comments, file header) described the previous text container and no longer
> apply — the reserved-keyword list they defined has moved to §5. The surviving
> subsections keep their original numbers so existing cross-references stay
> valid; the gaps are deliberate.

### 7.1 File structure

```json
{
  "version": "0.9",
  "palette": ["#RRGGBB", …],          // or "palette.json"
  "parts": [ { "name": …, "size": [W, H, D], "pivot": …, "sockets": …, "voxels": … } ]
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | no | Spec version string. Same field and semantics as the manifest's `version` (§6.1) |
| `palette` | no | Either an array of hex colors, or a §8 reference path to a shared palette file (§6.10). Omit only when every voxel is air |
| `parts` | **yes** | Array of part objects, at least one |

No other top-level fields are permitted (unknown field → `unknown`).

Encoding, line endings and byte-order-mark rules are as in §9. Whitespace
outside string literals is insignificant, so a file may be stored indented for
review and minified for transmission without any change of meaning or a
separate parser path.

### 7.4 Palette

```json
"palette": ["#1A1A1A", "#F4C9A0", "#8A8F98"]   // this file's own colors
"palette": "palette.json"                       // …or a shared palette (§6.10)
```

- **One field, two forms** — an array of entries, or a §8 reference path ending in `.json`. A file cannot do both, so no precedence rule is needed and nothing can shadow anything. (The manifest's `animations` values take the same either/or shape, §6.3.)
- **At most one** palette per file — it is a single field, so duplication is structurally impossible
- Each color in hex: `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`
- Color space: **sRGB**
- Maximum **64 colors** (palette indices `0..63`; more is `wrong-arity`)
- Voxel data references colors by single character:
  - `0`–`9` → palette indices 0–9
  - `a`–`z` → palette indices 10–35
  - `A`–`Z` → palette indices 36–61
  - `$` → palette index 62
  - `%` → palette index 63

  The last two are not alphanumeric because there is no alphanumeric left. 62 was
  never a decision — it is what three runs of digits and letters happen to total —
  and it left a 64-colour palette two short of fitting in one file, which is a
  common size to be two short of. Both characters are dense enough in an ASCII grid
  not to be mistaken for `.`, which rules out `,` `'` and `:`, and neither carries a
  meaning elsewhere in the format, which rules out `#`.
- The character `.` is reserved for empty space (air) and is **not** part of the palette

Position-based indexing: reordering the palette requires rewriting voxel data. Tooling can automate this.

**A geometry file's palette is always its own.** The manifest's top-level `palette` (§6.1) does not reach into a file — it is the default for geometry written *inline in the manifest* (§6.13) and nothing else. A file loaded through a `geometry` list or a part's `geometry.path` means the same thing to every reader, whatever manifest points at it.

A file that spells its colors out is range-checked at **parse time** — it is independently well-formed. A file that **references** a palette cannot be: the length is unknown until the referenced file is read, so its index-range check is deferred to cross-file validation (§6.10, §11.6), exactly as a palette-less file's is. Charset (`[.0-9a-zA-Z$%]`) and row-width checks always apply at parse time.

#### Material

A palette entry may also be an **object**: the same color, plus how it responds to light.

```json
"palette": [
  "#B8BEC6",
  { "color": "#C0C4CC", "metallic": 1, "roughness": 0.25 },
  { "color": "#FF6A3A", "emissive": 0.9 }
]
```

| field | range | default | meaning |
|---|---|---|---|
| `color` | hex, as above | *(required)* | the entry's color |
| `metallic` | `0..1` | `0` | 0 = dielectric, 1 = metal |
| `roughness` | `0..1` | `1` | 0 = mirror, 1 = fully diffuse |
| `emissive` | `0..1` | `0` | scales `color` as self-illumination |

- **The two forms are the same entry.** `"#B8BEC6"` and `{ "color": "#B8BEC6" }` decode identically, and both occupy one palette index. The 64-entry maximum counts entries, not forms.
- **The defaults are a plain matte surface** — exactly how a palette rendered before this field existed. A file that says nothing about material means what it always meant.
- **Canonical output writes the string form when the material is the default**, and omits default-valued keys otherwise. So a palette of plain colors round-trips byte-identically, and `{ "color": "#C0C4CC", "metallic": 1 }` does not grow two keys it never had.
- Names follow **glTF 2.0's metal-rough workflow**, which Unity, Godot and three.js consume without translation. glTF's `emissiveFactor` is `color × emissive`.
- Out of range is `invalid-value`; an unrecognized key is `unknown`; a missing `color` is `missing` (§11.2).

**Material is not normative for shading, and MUST NOT change geometry.** How a renderer turns `metallic` into pixels is its own business — a flat-shaded contact sheet and a PBR viewport are both conforming, and neither is required to reach the other's output. What *is* normative is that these fields change no face and no vertex: two models differing only in material have the same surfaces, the same corners, and the same triangles. (Alpha is the deliberate exception: it hides faces, below.)

#### What a mesh must agree on

Two implementations must produce the same **set** of faces for a model — same rectangles, same outward normals, same colors, same alphas, same materials. They need not produce them in the same order.

That is the whole of it, and the freedom is deliberate. Pinning the emission order would make any mesh optimisation — greedy meshing, most obviously, which merges coplanar faces and changes the triangle count outright — a breaking change to the format rather than a change to a renderer. A voxel format should not have to revise its spec to get faster.

Two consequences follow, and both are normative:

- **Comparing implementations is a set comparison.** A conformance check sorts the faces and compares; it does not diff index buffers. `cuboidy-query --mesh` in the reference implementation prints exactly that canonical form.
- **A material's position in a mesh's material list is derived from its VALUE, not from where it was first seen.** Order the distinct materials by `translucent` (opaque first), then `metallic`, then `roughness`, then `emissive`, each ascending. Grouping faces by material is what lets one part with three finishes be three draws, and a group has to name its material by index — so if that index came from iteration order, two implementations walking the voxel grid differently would hand the same face to different materials while both conformed to everything above.

**Alpha is opacity.** A palette color written `#RGBA` or `#RRGGBBAA` carries an alpha channel, and it means what it says: `FF` is opaque, `00` renders nothing, values between blend the voxel over whatever is behind it. A voxel of a translucent color is still a voxel — it occupies its cell, counts toward the bounding box, and answers a coordinate query — it is simply see-through.

Two rules make that drawable, and both are normative because two implementations must agree on the geometry they produce:

- **A face is dropped only when its neighbour hides it.** A neighbour hides a face when it is opaque, or when it is the very same palette index. Being merely solid is not enough. Drop a wall's face because a pane of glass sits against it and the glass looks onto a hole; keep the faces inside a body of one translucent color and every layer blends again, so three voxels of water read darker than one.
- **A run of one translucent color is one surface, whatever its thickness.** That is the consequence of the same-index half above, and it is deliberate: thickness is expressed by choosing a denser color, not by stacking. An implementation MUST NOT blend per layer.

Draw the opaque faces first, writing depth; then the translucent ones back to front, testing depth but not writing it. Sorting by mean face depth is sufficient — voxel faces do not interpenetrate.

Two details of that sentence are load-bearing, and both have been got wrong here already.

**"Back to front" is per FACE, not per model or per part.** Sorting whole objects and letting the faces inside one draw in whatever order the mesh builder emitted them is not an approximation of this rule; it is a different rule, and it fails from roughly half of all viewpoints. The symptom is not subtle once you know it: wedge-shaped patches of the far color surfacing through the near one, one per voxel, sliding as the camera orbits. It reads as geometry — as internal faces or shelves inside the block — which sends you looking in the mesh for faces that are not there.

**Faces are single-sided.** A voxel at `(x, y, z)` occupies the unit cube spanning `[x, x+1]` on each axis, and a face's four corners are wound **counter-clockwise seen from outside that cube**. An implementation MUST cull back faces. Where two different translucent colors meet, both voxels keep their face, so the shared rectangle carries two coincident quads pointing opposite ways. Culling resolves them: exactly one survives from any viewpoint, and it is the one whose color you are looking through. Render double-sided and that interface blends twice.

**An index that no palette entry defines renders as opaque magenta** (`#FF00FF`, fully opaque whatever the model's other colors do). Cross-file validation reports it (§11.6), but reporting is an authoring-time concern and a runtime that only draws must still have an answer — so the answer is a defined, deliberately conspicuous color rather than an error, a skipped voxel, or an out-of-bounds read. This applies wherever the index space is short: a palette-less file, a reference that did not resolve, or an inline part whose palette is shorter than the indices it uses.

### 7.5 Part object

```json
{
  "name": "head",
  "size": [4, 5, 4],
  "pivot": { "pos": [2, 0, 4] },
  "sockets": [ { "name": "hat", "pos": [2, 5, 2] } ],
  "voxels": [ ["0000", "0000", "0000", "0000"] ]
}
```

| Field | Cardinality | Notes |
|---|---|---|
| `name` | **exactly 1** | Must satisfy the §5 identifier rule |
| `size` | **exactly 1** | Missing → `missing` |
| `pivot` | at most 1 | Omit to accept the default |
| `sockets` | 0 or more | Omit or `[]` when there are none. Duplicate names → `duplicate` |
| `voxels` | **exactly 1** | Missing → `missing` |

No other fields are permitted (unknown field → `unknown`). Part names are unique across the whole model (§5), not merely within a file; a name defined in two geometry files is a cross-file `duplicate` error (§11.6).

### 7.6 `size`

```json
"size": [W, H, D]
```

- W = X-axis width, H = Y-axis height, D = Z-axis depth
- All values are positive integers in the range `[1, 1024]` per axis (zero or negative values, fractions, and values exceeding 1024 are `invalid-value`)
- Total voxel cells = W × H × D
- The 1024 cap is a sanity bound to keep validation and rendering tractable; future spec versions may relax it
- **Size the grid tight to the occupied volume.** A Y-layer with no solid cell lints as **W04** and a part with no solid cell at all as **W05** (§11.3), and `--strict` makes both fatal. So the common instinct — give every part of an assembly the same grid and taper it with air — is not available: shrink `H` instead of padding it. `size` is the bounding box of what the part contains, not a canvas it sits on

### 7.7 `pivot`

```json
"pivot": { "pos": [x, y, z] }
"pivot": { "pos": [x, y, z], "rot": [rx, ry, rz] }
```

- Optional. Default: position bottom-center, `[W/2, 0, D/2]`; rotation absent (identity)
- Position coordinates in **part-local space**, voxel units; may be fractional; may lie outside the grid bounds (W01 lint warning, not error)
- **Grid bounds are the closed box `[0, W] × [0, H] × [0, D]`.** Because a cell with index `x` occupies `[x, x+1)`, the coordinate `W` is the far *face* of the last cell, not one past it — so a pivot at `[W, 0, D]`, or a socket on the top face at `y = H`, is in bounds and does not warn. This is the natural place for a joint or an attachment point, so the inclusive reading is the one that matters
- Optional rotation: 3 Euler angles in degrees, ZXY intrinsic order (§4)
- **Semantic** (rest pose transform): `part.position` is the parent-space position of this part's pivot (§6.2), while `pivot.pos` is the same pivot point in part-local space. **Parent space is the coordinate frame whose origin coincides with the parent's pivot** (for a root part, parent space is world space). This is the standard rig convention — children attach to the parent's pivot, not to the corner of the parent's voxel grid. With matrix-vector convention and column vectors, a part-local point `v_local` lands at `v_parent = part.position + anim.pos + M_rot · M_pivot · M_anim · S_total · (v_local − pivot.pos)`, where `anim.pos` is the current keyframe `pos` delta, `M_rot` is the rotation matrix for the manifest part's `rotation` (§6.2; identity when absent), `M_pivot` is the rotation matrix for `pivot.rot` (identity when absent), `M_anim` is the animated rotation matrix, and `S_total` is the scale matrix for `S_rest ⊙ S_anim` — the manifest part's rest `scale` (§6.2; `[1,1,1]` when absent) times the animated scale. The two are one operator seen twice: both are per-axis, both act around `pivot.pos`, and both stop at the part (below), so they commute and their order does not matter. Rotation and scale are all applied around `pivot.pos`; no `+ pivot.pos` term is added after the transform because `part.position` already names the pivot's destination in parent space — and crucially, no `− parent.pivot.pos` term appears either, because parent space is *already* parent-pivot-centered (see hierarchy composition below). Equivalently in quaternion form for rotation: `q_total = q_rotation · q_pivot · q_anim` (the animation rotation is applied first, in the rest-pose-local frame, then the two rest terms — the geometry file's pivot rotation, then the manifest rotation — bring it to the rest orientation; `q_rest = q_rotation · q_pivot` is the rest pose rotation of §2)
- **Hierarchy composition** (rest pose, no rotation/scale): because `v_parent` is already in parent-pivot-centered coordinates, composing through the parent chain is a plain sum of `position` values; the part's own pivot is subtracted exactly once at the leaf, and no ancestor's pivot ever appears:

  ```
  v_world = Σ ancestor.position  +  (v_local − part.pivot.pos)
            └ root → … → part ┘
  ```

  Concretely, for a head parented to a body (no grandparent), a head voxel `v_local` lands at `body.position + head.position + (v_local − head.pivot.pos)`. The `body.pivot.pos` value does **not** appear — it controlled where body's *voxels* sit relative to body's origin, but the head's `position` is already specified relative to that same origin.
- **Hierarchy composition with rotation.** Once any ancestor carries a rest rotation (§6.2 `rotation`, or `pivot.rot`), the plain sum above no longer holds: a rotated parent turns the frame its children are positioned in. Each part's world transform is then built from its parent's:

  ```
  W.quat = parent.W.quat · q_rest            q_rest = q_rotation · q_pivot
  W.pos  = parent.W.pos  + parent.W.quat · part.position
  ```

  That is, a child's `position` is **rotated by the parent's accumulated world rotation** before being added — the child rides the parent's rotation exactly as it rides the parent's translation. A root part takes `W.quat = q_rest` and `W.pos = position`. The unrotated sum above is the special case where every `q_rest` is identity. Animation composes inside `q_rest` per the quaternion form above, so an animated hierarchy uses the same two lines with `q_rest · q_anim` in place of `q_rest`.

  **`scale` is the exception: it is not inherited.** Position and rotation propagate down the chain as above, but `scale` — the rest `scale` of §6.2 and the animated `scale` of §6.5 alike — applies only to the part's own `(v_local − pivot.pos)` and does **not** scale its children: they hang off the part's pivot at their normal size and ride only its position and rotation. Scaling a torso does not inflate the head attached to it, and does not move it either, because the head's `position` is measured from the torso's pivot and the pivot is the one point scale leaves alone. This follows from the transform equation, where `S_total` sits inside the part's own local term, but it is worth stating outright because rotation and scale otherwise behave alike.

  **Resizing a whole rig is therefore not what `scale` does.** Scaling every part by the same factor grows each part's voxels in place but leaves every `position` untouched, so the parts drift apart. A model meant to be authored at another size changes its `size` and `position` values, or its consumer scales the whole assembled model in the host engine.
- **Worked example**: body declares `"size": [5, 4, 8]` with default `"pivot": {"pos": [2.5, 0, 4]}` (bottom-center) and manifest `"position": [0, 4, 0]`. Head declares `"size": [5, 5, 5]` with `"pivot": {"pos": [2.5, 0, 5]}` (back-bottom-center, so the pivot is the connection point at the back of the head), parented to body with `"position": [0, 4, -4]`. Then: body's pivot sits at world `(0, 4, 0)`; head's pivot sits at world `(0, 4, 0) + (0, 4, -4) = (0, 8, -4)` — directly above body's pivot and 4 units forward (−Z). The head's back-bottom-center voxel `(2.5, 0, 5)` lands at world `(0, 8, -4) + ((2.5, 0, 5) − (2.5, 0, 5)) = (0, 8, -4)` ✓ (the pivot lands where `position` names). The head's front-left-bottom voxel `(0, 0, 0)` lands at world `(0, 8, -4) + ((0, 0, 0) − (2.5, 0, 5)) = (−2.5, 8, −9)`. Body's `pivot.pos = (2.5, 0, 4)` never enters either calculation

### 7.8 `sockets`

```json
"sockets": [
  { "name": "hat", "pos": [x, y, z] },
  { "name": "mouth", "pos": [x, y, z], "rot": [rx, ry, rz] }
]
```

- Zero or more per part
- `name` must satisfy the §5 identifier rule
- Position in part-local space, voxel units (fractional allowed)
- Optional rotation: Euler degrees, ZXY intrinsic order and right-hand sign convention (§4); absent → identity (`[0, 0, 0]`), matching `pivot.rot` (§7.7)
- Socket name unique within a part — **not** across the model. Two parts may each declare `tip`; §6.12 is what gives an attachment point a model-wide name
- A socket defines an attachment frame on the host part. Its origin is `socket.pos` in the host part's local space after the host part's own pivot transform has been applied. Its orientation is the host part's current orientation composed with `socket.rot`. An attached guest model is placed so the guest's **model origin** coincides with the socket origin (§6.12); per-attachment offsets and scale overrides are reserved for future versions.
- **A host part's `scale` moves its sockets** — the rest `scale` of §6.2 and the animated `scale` of §6.5 alike. A socket is a point in the part's geometry, so it goes through the same mapping every voxel does — `(socket.pos − pivot.pos) ⊙ S_total`, then the part's world orientation and position. A socket at the tip of an arm that stretches to 3× stays at the tip; one placed exactly on the pivot never moves at all. The **guest is not resized**: the frame carries position and orientation only, so an attached model travels to the right place at its own size rather than being deformed by what the host is doing.
- Declaring a socket does not expose it. Consumers address a socket through the manifest's published name (§6.12); a socket that is never published is internal to the model.

### 7.9 `voxels`

```json
"voxels": [
  ["<row>", …],   ← layer 0, exactly D rows
  ["<row>", …],   ← layer 1
  …               ← H layers total
]
```

- **Exactly one** `voxels` array per part
- The array contains H **layers**, one per Y-layer index in order
- The i-th element (0-based) is layer `i`. Layer indices are **positional** — there is no layer-name key
- Each layer contains exactly D voxel-row strings

**Errors:**

| Condition | Code |
|---|---|
| Layer count ≠ H | `wrong-arity` |
| Row count in a layer ≠ D | `wrong-arity` |
| Row width ≠ W | `wrong-arity` |
| Character outside `[.0-9a-zA-Z$%]` in a row | `invalid-value` |
| Row references palette index ≥ palette length | `invalid-value` |

The k-th row in layer `i` represents voxel cells at coordinates `(x, i, k)` for `x ∈ 0..W-1`.

### 7.10 Voxel row

- Each row is a JSON string
- Characters drawn from `[.0-9a-zA-Z$%]`, no whitespace inside a row
- Length exactly equals W
- Each character is either `.` (air) or a palette index character (must be within the declared palette range)

### 7.12 Examples

**Minimal single-part file** — a 3×2×3 crown in gold, hollow on top:

```json
{
  "version": "0.9",
  "palette": ["#FFD700"],
  "parts": [
    {
      "name": "crown",
      "size": [3, 2, 3],
      "pivot": { "pos": [1, 0, 1] },
      "voxels": [
        ["000", "000", "000"],
        ["0.0", "...", "0.0"]
      ]
    }
  ]
}
```

Layer 0 is a solid base; layer 1 keeps only the four corner pillars, so `.` carves out the hollow centre.

**Two parts with sockets and a non-default pivot:**

```json
{
  "version": "0.9",
  "palette": ["#6B6258", "#C5BFB5", "#1A1612"],
  "parts": [
    {
      "name": "body",
      "size": [5, 3, 6],
      "pivot": { "pos": [2, 0, 3] },
      "voxels": [
        ["11111", "11111", "11111", "11111", "11111", "11111"],
        ["00000", "00000", "00000", "00000", "00000", "00000"],
        ["00000", "00000", "00000", "00000", "00000", "00000"]
      ]
    },
    {
      "name": "head",
      "size": [5, 5, 5],
      "pivot": { "pos": [2, 0, 5] },
      "sockets": [
        { "name": "hat", "pos": [2, 4, 3] },
        { "name": "mouth", "pos": [2, 1, 0] }
      ],
      "voxels": [
        [".111.", ".111.", "11111", "11111", "11111"],
        [".222.", ".111.", "00000", "00000", "00000"],
        [".....", ".....", "20002", "00000", "00000"],
        [".....", ".....", "00000", "00000", "00000"],
        [".....", ".....", "00000", "00000", "00000"]
      ]
    }
  ]
}
```

**Shared palette by reference** — `palette` in its §8 reference form (§7.4).
Every geometry file in the model can name the same palette file, so the colors
are defined once; the index range is then checked cross-file, once the
reference resolves (§11.6):

```json
{
  "version": "0.9",
  "palette": "palette.json",
  "parts": [
    {
      "name": "body",
      "size": [4, 4, 2],
      "voxels": [
        ["0000", "0000"],
        ["0220", "0000"],
        ["0000", "0000"],
        ["0000", "0000"]
      ]
    }
  ]
}
```

`palette` may be omitted entirely only when the file has no colored voxels at
all — a file that uses indices must either spell its colors out or reference a
palette file.

---

## 8. Reference paths

Used by every reference field: the manifest's `geometry` entries (§6.9), its `animations` string values (§6.3), its top-level `palette` in reference form (§6.1), each part's `geometry.path` (§6.13), and a geometry file's `palette` in reference form (§7.4).

These rules govern the **path** only. Nothing in this format layers a fragment or a selector onto a path string — where a reference needs to name something *inside* the file it points at, it does so with a second field (§6.13's `part`), so a path is always just a path.

Rules:

- Resolved **relative to the file containing the reference** (typically `cuboidy.json`)
- Explicit extension required: `.json` for `geometry` entries, `palette` references and animation references
- Forward slashes `/` only
- Absolute paths (leading `/`) are forbidden
- URLs (`http://`, `https://`, `file://`) are forbidden
- `namespace:key` URIs are forbidden (the format has no registry)

Examples (assuming the reference is written in `models/owl/cuboidy.json`):

| Path | Resolves to |
|---|---|
| `anims/walk.json` | `models/owl/anims/walk.json` |
| `./anims/walk.json` | `models/owl/anims/walk.json` |
| `../shared/walk.json` | `models/shared/walk.json` |

A `../` path resolves as shown, but it leaves the package, and §3 defines a
model as a self-contained folder. Such a reference is syntactically valid and
may load in a tool that can see the parent directory, while a tool scoped to
one folder — a browser editor granted access to that folder, for instance —
cannot resolve it and reports it as unreadable. Keep references inside the
package unless the consumer is known to be workspace-aware.

Reference cycles (a → b → a) are an error.

---

## 9. Encoding

- **UTF-8 only**
- **Byte order mark (BOM) is forbidden**
- Line endings: LF (`\n`) or CRLF (`\r\n`); both accepted on read; LF preferred on write

---

## 10. Defaults summary

| Location | Field | Default |
|---|---|---|
| `cuboidy.json` | part `position` | `[0, 0, 0]` |
| `cuboidy.json` | part `rotation` | absent → identity (`[0, 0, 0]`) |
| `cuboidy.json` | part `scale` | absent → `[1, 1, 1]` |
| `cuboidy.json` | part `parent` | absent → root |
| `cuboidy.json` | `geometry` | absent → `["voxels.json"]` |
| `cuboidy.json` | part `geometry` | absent → the part of the same `name` in the `geometry` list (§6.13) |
| `cuboidy.json` | part `geometry.part` | absent → the enclosing part's `name` |
| `cuboidy.json` | `palette` | absent → inline geometry has no default palette |
| `cuboidy.json` | `sockets` | absent → no published sockets (§6.12) |
| `cuboidy.json` | `animations` | absent → no animations |
| `cuboidy.json` | `version` | absent → current spec version (`"0.9"` in this draft) |
| Keyframe (first) | `rot` | `[0, 0, 0]` |
| Keyframe (first) | `pos` | `[0, 0, 0]` |
| Keyframe (first) | `scale` | `[1, 1, 1]` |
| Keyframe (first) | `visible` | `true` |
| Keyframe (subsequent) | any omitted field | inherits from previous keyframe |
| `voxels.json` | `pivot` | `[W/2, 0, D/2]` (bottom-center) |
| `voxels.json` | socket rotation | `[0, 0, 0]` |
| Palette entry | alpha | absent from the hex → `FF` (opaque) |
| Palette entry | `metallic` | `0` (dielectric) |
| Palette entry | `roughness` | `1` (fully diffuse) |
| Palette entry | `emissive` | `0` (not a light source) |

The three material defaults are a plain matte surface, and they are worth
stating twice: §7.4 borrows glTF 2.0's field NAMES, and glTF's own
`metallicFactor` defaults to `1.0`. A reader that assumes the glTF default
renders every matte model as metal.

---

## 11. Validation & lint

A Cuboidy package is **well-formed** if it passes all error-level rules.

### 11.1 Severity levels

| Level | Meaning | Implementation behavior |
|---|---|---|
| **Error** (structural codes — §11.2) | Spec violation | Refuse to load (or recover only on explicit request) |
| **Warning** (`W`) | Spec-valid but suspicious | Load with warning emitted |
| **Hint** (`H`) | Style or convention | Load with hint emitted |

A conformance tool offering a strict mode SHOULD draw the line between the two
advisory levels: **every warning fails strict mode, no hint does.** That makes
the `W` / `H` split the operative decision when classifying a new rule, not a
matter of presentation.

### 11.2 Diagnostic codes (structural)

Cuboidy uses **five structural codes** to describe errors. The code names what *kind* of structural violation occurred; the message text names *what specifically* — which keyword, which field, which line. Implementations MUST use these exact code strings so that cross-language parity tests can compare outputs by code alone.

| Code | Meaning | Voxel-definition examples |
|---|---|---|
| `missing` | A required structural element is absent. | No `parts`, or `parts` present but empty; `name`, `size` or `voxels` absent on a part. (An absent `palette` is **not** an error — §7.4; palette availability is validated cross-file, §11.6) |
| `duplicate` | A unique-constraint violation: an element that should appear at most once appears more than once. | Two parts sharing a `name`; two sockets on one part sharing a `name` |
| `unknown` | An unrecognized name appears where the spec defines a closed set. | A top-level field other than `version` / `palette` / `parts`; a part field other than `name` / `size` / `pivot` / `sockets` / `voxels`; an unrecognized key on a `pivot` or `socket` object |
| `invalid-value` | A value is present but malformed. | Malformed color (`#GG`); a voxel row containing a character outside `[.0-9a-zA-Z$%]`; a voxel cell naming a palette index that does not exist (checked at parse time only when the file spells its colors out — a referenced palette is checked cross-file, §7.4); a `size` dimension outside `[1..1024]` or non-integer; a non-numeric coordinate in `pivot` / `socket`; an identifier failing the §5 rule; a value of the wrong JSON type for its field (e.g. `"size": ["3", 1, 1]`) |
| `wrong-arity` | An incorrect number of items. | Voxel-row width does not match declared `W`; a layer's row count differs from declared `D`; the layer count differs from declared `H`; an inline palette with 0 colors or more than 64; `size` or a coordinate that is not a triple |

Note: v0.1 used per-keyword codes (E01–E19); v0.2 restructured them into the five structural categories above, and they have been stable since — the move to a JSON container in v0.9 changed which mistakes are *possible*, not what the codes mean. What specifically went wrong survives in the message string and in the fixture filenames (`fixtures/geometry/<code>/<descriptor>.json`).

### 11.3 `voxels.json` warnings

| ID | Rule |
|---|---|
| W01 | Pivot outside voxel grid bounds |
| W02 | Socket outside voxel grid bounds |
| W03 | Palette index declared but never used |
| W04 | Layer-section entirely empty (all `.`) |
| W05 | Part has no solid voxels (all `.`) |

### 11.4 `voxels.json` hints

| ID | Rule |
|---|---|
| H01 | Part name violates `lower_snake_case` or `lower-kebab-case` convention |
| H02 | Pivot uses fractional value in an otherwise integer-aligned grid |

### 11.5 `cuboidy.json` errors

Manifest errors use the same five structural codes (§11.2). The TS reference implementation maps observed validation failures as follows; other implementations should converge on the same mapping for parity:

| Code | Manifest examples |
|---|---|
| `missing` | Top-level `name` is absent; top-level `parts` is absent or empty; **`cuboidy.json` itself is absent** (§3); an inline part `geometry` without `size` or `voxels` (§6.13); palette file's `colors` is absent (§6.10) |
| `duplicate` | Duplicate part name; duplicate animation name (planned) |
| `unknown` | A field other than `name` / `version` / `geometry` / `palette` / `parts` / `sockets` / `animations` is present at the top level; a field other than `name` / `parent` / `position` / `rotation` / `geometry` is present inside a part; a field other than `part` / `socket` inside a published socket (§6.12); in a part's `geometry` (§6.13), a field other than `path` / `part` in the reference form, or `name` / anything outside §7.5 + `palette` in the inline form — including `path` mixed with inline fields; a field other than `colors` in a palette file |
| `invalid-value` | Wrong type for a field (e.g. `name` is a number); identifier failing the §5 regex; a `geometry` / `palette` / animation reference path violating §8 (wrong extension, backslash, absolute, URL/URI, empty segment) — including a part's `geometry.path` (§6.13); duplicate or empty `geometry` list; malformed color string in a palette file; `parent` references a non-existent part; a published socket's `part` references a non-existent part (§6.12); parent chain contains a cycle; animation `duration` non-positive, non-finite, or less than the largest time key; time keys not decimal-number strings, not strictly increasing, or not starting at `"0.0"` |
| `wrong-arity` | Palette file's `colors` is empty or exceeds 64 entries (§6.10) |

Items marked "planned" are not yet implemented in the TS reference; the catch-all `invalid-value` may surface generic Zod messages for those cases until then. External animation files (§6.3 string refs) are validated with the same inline-animation rules when the project is resolved (lint, inspection CLIs, editor); a missing or invalid referenced file is an error there.

### 11.6 Cross-file rules

Cross-file validation operates on the **project**: the manifest plus its referenced geometry files (§6.9) and any palette files those point at (§6.10, §7.4).

Most of these rules are *reporting*, and an implementation that only needs to draw a model may skip them. The `duplicate` row below is the exception: a part name defined in two listed files leaves the by-`name` lookup with no answer, so **resolution itself fails** and there is nothing to draw. An implementation that resolves references but does not lint MUST still refuse to bind it: **the name resolves to nothing**, and the part has no shape. Returning one of the two candidates would make the answer a fact about the reader collections rather than about the model, and two implementations would disagree about which shape the name means. Resolution stops there; reporting the ambiguity is this section's job, alongside every other finding about the model.

| Code | Severity | Rule |
|---|---|---|
| `missing` | error | A part with no `geometry` (§6.13) is not defined in **any** file of the `geometry` list — the by-`name` lookup found nothing |
| `missing` | error | A part's `geometry.path` (§6.13) does not resolve, or the file it names has no part called `geometry.part` (default: the enclosing part's `name`). Unlike the row above this names the file it looked in, because the author said which one |
| `duplicate` | error | The same part name is defined in **more than one** file of the `geometry` list (§5 uniqueness is model-wide, which is what makes the by-`name` lookup unambiguous). Files reached only by an explicit `geometry.path` do not take part in this check |
| `unknown` | warning | A geometry file in the `geometry` list defines a part that no manifest part resolves to |
| `missing` | error | A geometry file's voxels use color indices while it declares no palette, or while its §7.4 palette reference does not resolve. Same for an **inline** part (§6.13) that resolves to no palette by either of its two routes — its own, or the manifest's |
| `invalid-value` | error | A geometry file references a palette index outside the range of the palette it **points at** (only a referenced palette reaches this check; an inline one is validated at parse time — §7.4) |
| — | — | **W03 does not apply to a referenced palette.** "Declared but unused" is only meaningful about colors a file owns; a shared palette exists precisely so each file can use a subset of it (§6.10) |
| `invalid-value` | warning | **[W06]** an `<x>-l` / `<x>-r` part pair (same parent) whose occupied voxels are not mirror images across the parent's YZ plane, computed from manifest position + pivot + voxel occupancy. The check is geometric, not positional: a correctly mirrored part reflects its pivot too, so the matching hand-written position is often legitimately NOT the sign-opposite. **Scope, both parts of which are easy to trip over:** the side letter must be the *last* character with `-` or `_` before it, so `foreleg-l`/`foreleg-r` is checked while `leg-fl`/`leg-fr` is not; and the pair must share a parent, so `shin-l`/`shin-r` hanging off `thigh-l`/`thigh-r` is never compared. Most limb pairs below the first joint are therefore unchecked. Rest rotations do not participate — mirroring one is the author's responsibility (across the YZ plane, Euler `[x, y, z]` mirrors to `[x, −y, −z]`) |
| `invalid-value` | warning | **[W08]** a manifest-level `palette` (§6.1) that no inline part uses — every part either declares its own or takes its colors from a file, so the binding does nothing. Most often a v0.7 manifest, where the field overrode geometry files instead (§6.13) |
| `invalid-value` | warning | **[W07]** a geometry file exists in the package but is referenced by neither the manifest `geometry` list nor any part's `geometry.path` (usually a forgotten entry — §6.9). "Geometry file" is decided by **content, not extension**: a file is one if the §7 reader accepts it. Since v0.9 the manifest, palette files and animation clips are all `.json` too, so an extension test would flag every one of them |
| `unknown` | warning | Animation targets a part not present in `cuboidy.json` `parts` (cross-rig sharing, §6.8) |
| `missing` | error | A published socket (§6.12) names a `socket` that its host part does not declare in geometry (§7.8). The other half — a `part` that is not in `parts` at all — is a manifest-level `invalid-value` (§11.5), because it needs no geometry file to detect |
| `unknown` | runtime error | Attempt to attach to a socket name the model does not publish (§6.12). Unlike the two rules above this is a **consumer**-side failure: the package is well-formed, and the name simply is not in its `sockets` object |

### 11.7 Diagnostic format

Implementations should emit diagnostics in the form:

```
<file>:<line>[:<col>]: <severity>: <message> [<rule-id>]
```

Example:

```
voxels.json:5:1: error: row width 4, expected 3 (per `size 3 2 4`) [wrong-arity]
voxels.json:12: warning: pivot [3, 0, 5] outside grid bounds [0..3, 0..3, 0..4] [W01]
cuboidy.json:18: error: animation 'walk' targets part 'wing' not in model [missing]
```

This format is gcc / clang compatible for IDE integration.

### 11.8 Error precedence

Validation runs in four phases, and **a phase runs only if every earlier phase
passed**. When violations from different phases coexist, the earlier phase is
what gets reported — this is what parity testing compares.

1. **JSON syntax.** A document that is not well-formed JSON fails here, and no
   Cuboidy code applies: the JSON parser's own error is reported.
2. **Structural schema** — each field considered on its own:
   - **`unknown`** — a field the spec does not define, at any level
   - **`missing`** — a required field is absent (`parts`; a part's `name`,
     `size` or `voxels`; the manifest's `name`), or `parts` is present but
     empty, which means the same thing
   - **`wrong-arity`** — a fixed-length array of the wrong length (`size` or a
     coordinate that is not a triple); a palette with more than 64 colors, or
     an inline palette with none
   - **`invalid-value`** — right shape, wrong content: a malformed color, a
     `size` dimension outside `[1..1024]` or non-integer, a voxel row
     containing a character outside `[.0-9a-zA-Z$%]`, an identifier failing §5,
     a reference path violating §8
3. **Cross-field rules**, which need more than one field at a time and are
   therefore only reachable once the document is structurally sound. Parts are
   examined in document order; within a part:
   - **`duplicate`** — the part's name repeats one already seen in this file
   - **`wrong-arity`** — the layer count differs from `H`; then, per layer, the
     row count differs from `D`; then, per row, the width differs from `W`.
     Each level stops descending when it fails, so a part with the wrong layer
     count reports that rather than a cascade of row errors
   - **`invalid-value`** — a cell names a palette index the file's own palette
     does not define, at most one report per row. Skipped entirely when the
     palette is a §7.4 reference or absent — the range is unknown until phase 4
   - **`duplicate`** — two sockets on the part share a name
4. **Cross-file validation** (§11.6), once the project resolves: part names
   across geometry files, manifest↔geometry agreement, per-part `geometry`
   references resolving (§6.13), palette resolution and the index ranges
   phase 3 deferred.

**Inline geometry** (§6.13) takes the same four phases, in the manifest rather
than a geometry file: its `size` and `voxels` are phase 2, its layer/row/width
agreement with `size` is phase 3, and its palette indices are range-checked at
phase 3 only against a palette **it spells out itself**. An inline part that
references a palette, or inherits the manifest's, defers to phase 4 for the
same reason a §7.4 reference does — even when the manifest's palette is an
array in the same document, so that where the colors are written never changes
when an error is reported.

Where several violations coexist *within* one phase, which is reported is
implementation-defined; every shared fixture holds exactly one error, so parity
does not depend on that choice. Reporting a violation from a **later** phase
than one that is also present is non-conforming, because it means an earlier
check did not run.

---

## 12. Reference examples

The reference repository includes:

- `models/knight/` — multi-part rigged humanoid over three geometry files sharing one palette, with a walk clip and two published sockets (§6.12): `weapon` → `hand-r:grip`, `crest` → `head:crest`
- `models/sword/` — single-part static accessory, authored around its origin so it seats in `knight`'s published `weapon` socket
- `models/owl/`, `models/koi/`, `models/fox/` — non-humanoid rigs (segmented wings, a body chain, a quadruped gait)
- `models/windmill/` — a `geometry` list plus a shared palette file, and two constant-rate rotations in one clip

All reference examples pass the current lint rules at error level.

---

## 13. Packed format (`.cuboidy`)

A package is a folder (§3). For distribution it may be delivered as a single
**ZIP archive** named `<name>.cuboidy`. The archive carries no information the
folder does not: unpacking one and opening the folder MUST give the same model.

### 13.1 Layout

`cuboidy.json` is the anchor inside the archive exactly as it is on disk.

- A writer MUST place `cuboidy.json` at the **archive root**, with every other
  file at its package-relative path beside it (`palette.json`,
  `anims/walk.json`).
- A reader MUST also accept an archive whose entries all sit under **one**
  top-level directory — what a user gets by right-clicking a folder and
  compressing it — and MUST strip that directory before resolving anything.
  The wrapper's name is not the model's name; §3 already says the folder name
  is not authoritative.
- Stripping applies only when *every* entry shares one top-level directory. Two
  top-level entries, or an archive with `cuboidy.json` at the root, are read
  as-is.

This is the reader-tolerant / writer-strict split the canonical serializer
already uses: one form is produced, two are understood.

### 13.2 Entry paths

Entry names are UTF-8 and use `/` as the separator. The §8 reference-path rules
apply to them as well, and for the same reason — an archive is a hostile input:

- An absolute path, a backslash, or a `..` segment is **`invalid-value`**. A
  reader MUST reject the archive rather than sanitising the path, because a
  sanitised `../` is silently a different file from the one the author named.
- Two entries that normalise to the same path are **`duplicate`**.
- Directory entries (names ending `/`) are optional. A reader MUST NOT depend
  on them and MUST NOT treat one as a file.

### 13.3 Entries a reader does not understand

An archive may contain files outside this specification — a thumbnail, a
licence, an editor's own sidecar.

- A reader MUST NOT reject the archive for containing them.
- A tool that reads an archive and writes it back **MUST preserve them
  byte-for-byte**. Dropping an unrecognised entry turns "open and save" into
  silent data loss, and the author has no way to notice until the file is
  needed.
- They take no part in validation. §11.6's W07 asks whether a *geometry* file
  is referenced, and geometry is decided by content, so an unrecognised entry
  is simply not one.

### 13.4 Archive constraints

- **Compression**: `store` (0) and `deflate` (8) MUST be supported. Any other
  method is `invalid-value`.
- **No encryption**, no multi-volume archives, no ZIP64 requirement — a model
  that needs either is outside what this format is for.
- **Encoding**: §9 governs file *contents* unchanged (UTF-8, no BOM). Entry
  *names* are UTF-8; a reader MAY reject names it cannot decode.
- **Bounds**: a reader MUST bound the total uncompressed size and the entry
  count before expanding an archive, and SHOULD document the limits it applies.
  No figure is mandated — the requirement is that a decompression bomb is
  refused rather than expanded.

### 13.5 What packing does not change

Packing is transport. Reference paths (§8) resolve inside the archive exactly
as they would inside the folder, the anchor is still `cuboidy.json`, and an
unreferenced file is still not part of the model (§3). A `.cuboidy` is not a
different format; it is the same package with one fewer directory to hand
someone.

---

## 14. Future extensions (out of scope for v0.9)

- **Named palette colors / metadata**: the palette file's object form (§6.10) reserves the room
- **Multi-character palette encoding**: 2-character indices for palettes larger than 64.
  Deferred rather than dropped, and the bar is higher than it was: one character per
  cell is what makes a row's length its width, and 64 covers the palette sizes that
  are actually distributed
- **Animation blending**: simultaneous animations with weighted contribution
- **Custom easing curves**: cubic-bezier control points beyond the §6.7 named presets
- **Standardized rig vocabularies**: humanoid / quadruped / biped contracts (analogous to VRM humanoid spec)
- **Inverse kinematics**: solver-driven part chains
- **Composition** — recording *that* an attachment happens. As of v0.9 a package states what it offers: §7.8 defines a socket's frame, §6.12 publishes the ones consumers may use under model-wide names, and §11.6 makes an unresolvable published name an error. What no package can say is that a particular sword belongs in the knight's hand. That is deliberate rather than pending: an attachment record is about a *arrangement of several models*, and it needs a lifetime, a coordinate root, an animation policy per participant and a resolution rule for missing assets — a scene, not an asset. Cuboidy specifies the asset. A composition layer should own the scene and reference models through their published sockets, and it should be specified separately so that a model file never depends on knowing where it is used.
- **Per-attachment overrides**: rotation / scale offsets on top of the §7.8 frame, once a composition layer exists to carry them

---

## 15. Acknowledgments

Cuboidy's design draws from prior work in voxel and rigging formats:
Minecraft Bedrock Edition, Mixamo, MagicaVoxel, VRM, glTF, Pixar USD.

---

*End of specification.*
