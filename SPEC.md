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

Cuboidy is **not** a triangle-mesh format. It does not specify skin weights, UV coordinates, materials, or shaders. Voxel parts are rigid; the runtime renders them as flat-shaded cells.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Cuboidy format** | The spec defined by this document |
| **Cuboidy model** (or **package**) | A single asset, stored as a folder |
| **Manifest** | `cuboidy.json` — the package's fixed-name anchor: rig hierarchy, animations, and the geometry list |
| **Geometry file** | A JSON file (§7) — shape, optional inline palette, pivot, sockets. Default (when the manifest lists none): `voxels.json` |
| **Palette file** | A `.json` file of shareable colors (§6.10), referenced by each geometry file that uses them (§7.4) |
| **Packed Cuboidy** | `<name>.cuboidy` — ZIP archive of the package (reserved; not specified in v0.9) |
| **Part** | A rigid voxel sub-object, optionally parented in the hierarchy |
| **Socket** | A named attachment point on a part |
| **Keyframe** | A time-indexed pose snapshot for an animated part |
| **Rest pose** | A part's pose when no animation is active: position = `part.position` (in parent space), rotation = the manifest part's `rotation` composed with the geometry file's `pivot.rot` (`q_rotation · q_pivot`, both around `pivot.pos`; each identity when absent), scale = `[1,1,1]` |

---

## 3. Folder structure

A Cuboidy model is stored as a folder. The folder's name is conventional and not authoritative; the manifest's `name` field is.

`cuboidy.json` is the package's **only fixed filename** — the deterministic entry point a loader looks for (the same role `.gltf` or `package.json` play). Every other file is named freely and found by reference from the manifest (§8): geometry files via `geometry` (§6.9), a shared palette via `palette` (§6.10), external animations via `animations` string values (§6.3).

```
my-model/
├── cuboidy.json         required — manifest (the anchor)
├── voxels.json          geometry — the default when `geometry` is absent
└── anims/               optional — shared / external animation files
    ├── walk.json
    └── idle.json
```

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
  "parts": [ ... ],
  "animations": { ... }
}
```

The manifest has no `palette` field. Colors belong to the geometry file that
uses them (§7.4), which may name a shared palette file (§6.10).

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Model identifier |
| `version` | no | string | Spec version this model targets. Absent → the current spec version (`"0.9"` in this draft) |
| `geometry` | no | array of reference paths | The model's geometry files (§6.9). Absent → `["voxels.json"]` |
| `parts` | **yes** | array (non-empty) | At least one part |
| `animations` | no | object | Map from animation name to definition. Absent → no animations |

### 6.2 Part object

```json
{
  "name": "<identifier>",
  "parent": "<identifier>",
  "position": [x, y, z],
  "rotation": [rx, ry, rz]
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Unique within model |
| `parent` | no | string (identifier) | Another part's name. Absent → this part is a root |
| `position` | no | `[number, number, number]` | Where this part's pivot sits in **parent space** — voxel-unit offset from the parent's pivot (root parts: offset from world origin). Default `[0, 0, 0]` (this part's pivot coincides with the parent's pivot). See §7.7 for the full transform semantics |
| `rotation` | no | `[number, number, number]` | The part's **rest rotation** in parent space: Euler degrees, ZXY intrinsic order (§4), applied around the part's pivot. Composes outside the geometry file's `pivot.rot` (`q_rest = q_rotation · q_pivot`, §7.7) and is inherited by children like any parent transform. Default: absent → identity |

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
| `parts` | **yes** | object | Map from part name to keyframe sequence. May be empty (no part animates) |

### 6.5 Keyframe values

| Field | Type | Interpretation | Default at first keyframe |
|---|---|---|---|
| `rot` | `[rx, ry, rz]` Euler degrees | **Relative** to rest pose rotation (the manifest part's `rotation` composed with the part's `pivot.rot`; identity when both are absent). Composed as described in §7.7 | `[0, 0, 0]` |
| `pos` | `[dx, dy, dz]` voxel units | **Delta** added to `part.position`, and therefore in the same frame — parent space. It rides the ancestors' rest rotations exactly as `position` does, and is **not** turned by the part's own `rotation` or `pivot.rot` (§7.7 places it outside `M_rot`) | `[0, 0, 0]` |
| `scale` | `[sx, sy, sz]` multipliers | **Multiplier** from rest scale (`[1,1,1]`). Per-axis, non-uniform allowed. Applied around the same pivot point as `rot` | `[1, 1, 1]` |
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

- Format: JSON string of a decimal number, e.g., `"0.0"`, `"0.5"`, `"1.25"`
- Unit: seconds (IEEE 754 double precision)
- Must start at `"0.0"` for every animated part
- Must be strictly increasing across the sequence for a given part
- Maximum time key must be ≤ `duration`

### 6.7 Interpolation

Between consecutive keyframes:

- `rot`, `pos`, `scale` interpolate along the segment's **easing curve** (below); with the default `linear` ease this is plain linear interpolation
- **Interpolation is component-wise on the stored triple.** For `rot` this means the three Euler angles are interpolated independently — *not* converted to quaternions and slerped. The two agree for small rotations and diverge as they grow, so this is a conformance requirement, not an implementation detail. It is also what makes a full revolution expressible: a segment from `0` to `−360` on one axis is a constant-rate turn under component-wise interpolation, where a slerp would treat the endpoints as the same orientation and produce no motion at all.
- `visible` uses **step** interpolation: the value at the later keyframe takes effect at that keyframe's time

#### Easing

Each attribute's curve over a segment is named by the `ease` map of the segment's **outgoing** keyframe (the earlier of the pair): `"ease": { "rot": "out-elastic" }` shapes **only** `rot`, **only** across the segment leaving that keyframe. There is no carryover (§6.5) and no cross-attribute effect — an attribute absent from the map interpolates linearly, so a curve can never leak onto later segments or onto other attributes that happen to cross the same span. To ease several consecutive segments, name the curve on each of their outgoing keyframes.

An easing is a pure remap `u → u'` of normalized segment progress (`u = 0` at the outgoing keyframe, `u = 1` at the next), applied before linear interpolation of that attribute's values. Every preset maps `0 → 0` and `1 → 1`, so keyed values are always hit exactly at their keyframes. The presets and their formulas follow the de-facto standard set popularized by easings.net:

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
- The model's parts are the union of all listed files, in list order. **Part names are unique across the whole model** (§5) — a name defined in two geometry files is a cross-file `duplicate` error (§11.6).
- A geometry file present in the package but not listed here is not part of the model and lints as **W07** (§11.6).

### 6.10 External palette file

A geometry file may keep its colors in a separate file and point at it, so several geometry files can share one palette (§7.4):

```json
"palette": "palette.json"
```

- A **reference path** (§8) ending in `.json`, written in the **geometry file**, not the manifest. Each geometry file decides for itself; two files sharing a palette simply name the same path.
- Swapping a palette file recolors every geometry file pointing at it (skins).
- The referenced file's colors are the referring file's palette outright — there is no inline palette underneath to override, because `palette` is one field with two forms.
- A geometry file whose voxels use color indices while it declares **no** palette in either form is a cross-file `missing` error, as is one whose reference does not resolve.

The palette file itself is a standard JSON document:

```json
{ "colors": ["#1a1a1a", "#f4c9a0", "#RRGGBBAA"] }
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `colors` | **yes** | array of strings (non-empty) | Same color grammar as §7.4 (`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`, sRGB). Maximum **62** entries; index assignment is positional and identical to §7.4 (`0-9a-zA-Z`) |

No other fields are permitted (`unknown`). The object form (rather than a bare array) reserves room for future metadata without a breaking change.

### 6.11 Concurrency

A model may have at most **one active animation** at a time. Blending, layering, and per-part overlays are reserved for future spec versions.

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

- **One field, two forms** — an array of colors, or a §8 reference path ending in `.json`. A file cannot do both, so no precedence rule is needed and nothing can shadow anything. (The manifest's `animations` values take the same either/or shape, §6.3.)
- **At most one** palette per file — it is a single field, so duplication is structurally impossible
- Each color in hex: `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`
- Color space: **sRGB**
- Maximum **62 colors** (palette indices `0..61`; more is `wrong-arity`)
- Voxel data references colors by single character:
  - `0`–`9` → palette indices 0–9
  - `a`–`z` → palette indices 10–35
  - `A`–`Z` → palette indices 36–61
- The character `.` is reserved for empty space (air) and is **not** part of the palette

Position-based indexing: reordering the palette requires rewriting voxel data. Tooling can automate this.

A file that spells its colors out is range-checked at **parse time** — it is independently well-formed. A file that **references** a palette cannot be: the length is unknown until the referenced file is read, so its index-range check is deferred to cross-file validation (§6.10, §11.6), exactly as a palette-less file's is. Charset (`[.0-9a-zA-Z]`) and row-width checks always apply at parse time.

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
- **Semantic** (rest pose transform): `part.position` is the parent-space position of this part's pivot (§6.2), while `pivot.pos` is the same pivot point in part-local space. **Parent space is the coordinate frame whose origin coincides with the parent's pivot** (for a root part, parent space is world space). This is the standard rig convention — children attach to the parent's pivot, not to the corner of the parent's voxel grid. With matrix-vector convention and column vectors, a part-local point `v_local` lands at `v_parent = part.position + anim.pos + M_rot · M_pivot · M_anim · S_anim · (v_local − pivot.pos)`, where `anim.pos` is the current keyframe `pos` delta, `M_rot` is the rotation matrix for the manifest part's `rotation` (§6.2; identity when absent), `M_pivot` is the rotation matrix for `pivot.rot` (identity when absent), `M_anim` is the animated rotation matrix, and `S_anim` is the animated scale matrix. Rotation and scale are all applied around `pivot.pos`; no `+ pivot.pos` term is added after the transform because `part.position` already names the pivot's destination in parent space — and crucially, no `− parent.pivot.pos` term appears either, because parent space is *already* parent-pivot-centered (see hierarchy composition below). Equivalently in quaternion form for rotation: `q_total = q_rotation · q_pivot · q_anim` (the animation rotation is applied first, in the rest-pose-local frame, then the two rest terms — the geometry file's pivot rotation, then the manifest rotation — bring it to the rest orientation; `q_rest = q_rotation · q_pivot` is the rest pose rotation of §2)
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

  **`scale` is the exception: it is not inherited.** Position and rotation propagate down the chain as above, but an animated `scale` applies only to the part's own `(v_local − pivot.pos)` and does **not** scale its children — they hang off the part's pivot at their normal size and ride only its position and rotation. Scaling a torso does not inflate the head attached to it. This follows from the transform equation, where `S_anim` sits inside the part's own local term, but it is worth stating outright because rotation and scale otherwise behave alike.
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
- Socket name unique within a part
- A socket defines an attachment frame on the host part. Its origin is `socket.pos` in the host part's local space after the host part's own pivot transform has been applied. Its orientation is the host part's current orientation composed with `socket.rot`. An attached child asset is placed so the child's root pivot coincides with the socket origin; per-attachment offsets and scale overrides are reserved for future versions.

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
| Character outside `[.0-9a-zA-Z]` in a row | `invalid-value` |
| Row references palette index ≥ palette length | `invalid-value` |

The k-th row in layer `i` represents voxel cells at coordinates `(x, i, k)` for `x ∈ 0..W-1`.

### 7.10 Voxel row

- Each row is a JSON string
- Characters drawn from `[.0-9a-zA-Z]`, no whitespace inside a row
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

Used by every reference field: the manifest's `geometry` entries (§6.9) and `animations` string values (§6.3), and a geometry file's `palette` when written in reference form (§7.4).

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
| `cuboidy.json` | part `parent` | absent → root |
| `cuboidy.json` | `geometry` | absent → `["voxels.json"]` |
| `cuboidy.json` | `animations` | absent → no animations |
| `cuboidy.json` | `version` | absent → current spec version (`"0.9"` in this draft) |
| Keyframe (first) | `rot` | `[0, 0, 0]` |
| Keyframe (first) | `pos` | `[0, 0, 0]` |
| Keyframe (first) | `scale` | `[1, 1, 1]` |
| Keyframe (first) | `visible` | `true` |
| Keyframe (subsequent) | any omitted field | inherits from previous keyframe |
| `voxels.json` | `pivot` | `[W/2, 0, D/2]` (bottom-center) |
| `voxels.json` | socket rotation | `[0, 0, 0]` |

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
| `invalid-value` | A value is present but malformed. | Malformed color (`#GG`); a voxel row containing a character outside `[.0-9a-zA-Z]`; a voxel cell naming a palette index that does not exist (checked at parse time only when the file spells its colors out — a referenced palette is checked cross-file, §7.4); a `size` dimension outside `[1..1024]` or non-integer; a non-numeric coordinate in `pivot` / `socket`; an identifier failing the §5 rule; a value of the wrong JSON type for its field (e.g. `"size": ["3", 1, 1]`) |
| `wrong-arity` | An incorrect number of items. | Voxel-row width does not match declared `W`; a layer's row count differs from declared `D`; the layer count differs from declared `H`; an inline palette with 0 colors or more than 62; `size` or a coordinate that is not a triple |

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
| `missing` | Top-level `name` is absent; top-level `parts` is absent or empty; palette file's `colors` is absent (§6.10) |
| `duplicate` | Duplicate part name; duplicate animation name (planned) |
| `unknown` | A field other than `name` / `version` / `geometry` / `parts` / `animations` is present at the top level; a field other than `name` / `parent` / `position` / `rotation` is present inside a part; a field other than `colors` in a palette file |
| `invalid-value` | Wrong type for a field (e.g. `name` is a number); identifier failing the §5 regex; a `geometry` / animation reference path violating §8 (wrong extension, backslash, absolute, URL/URI, empty segment); duplicate or empty `geometry` list; malformed color string in a palette file; `parent` references a non-existent part; parent chain contains a cycle; animation `duration` non-positive, non-finite, or less than the largest time key; time keys not decimal-number strings, not strictly increasing, or not starting at `"0.0"` |
| `wrong-arity` | Palette file's `colors` is empty or exceeds 62 entries (§6.10) |

Items marked "planned" are not yet implemented in the TS reference; the catch-all `invalid-value` may surface generic Zod messages for those cases until then. External animation files (§6.3 string refs) are validated with the same inline-animation rules when the project is resolved (lint, inspection CLIs, editor); a missing or invalid referenced file is an error there.

### 11.6 Cross-file rules

Cross-file validation operates on the **project**: the manifest plus its referenced geometry files (§6.9) and any palette files those point at (§6.10, §7.4).

| Code | Severity | Rule |
|---|---|---|
| `missing` | error | A manifest part name is not defined in **any** geometry file |
| `duplicate` | error | The same part name is defined in **more than one** geometry file (§5 uniqueness is model-wide) |
| `unknown` | warning | A geometry file defines a part not listed in `cuboidy.json` `parts` |
| `missing` | error | A geometry file's voxels use color indices while it declares no palette, or while its §7.4 palette reference does not resolve |
| `invalid-value` | error | A geometry file references a palette index outside the range of the palette it **points at** (only a referenced palette reaches this check; an inline one is validated at parse time — §7.4) |
| — | — | **W03 does not apply to a referenced palette.** "Declared but unused" is only meaningful about colors a file owns; a shared palette exists precisely so each file can use a subset of it (§6.10) |
| `invalid-value` | warning | **[W06]** an `<x>-l` / `<x>-r` part pair (same parent) whose occupied voxels are not mirror images across the parent's YZ plane, computed from manifest position + pivot + voxel occupancy. The check is geometric, not positional: a correctly mirrored part reflects its pivot too, so the matching hand-written position is often legitimately NOT the sign-opposite. **Scope, both parts of which are easy to trip over:** the side letter must be the *last* character with `-` or `_` before it, so `foreleg-l`/`foreleg-r` is checked while `leg-fl`/`leg-fr` is not; and the pair must share a parent, so `shin-l`/`shin-r` hanging off `thigh-l`/`thigh-r` is never compared. Most limb pairs below the first joint are therefore unchecked. Rest rotations do not participate — mirroring one is the author's responsibility (across the YZ plane, Euler `[x, y, z]` mirrors to `[x, −y, −z]`) |
| `invalid-value` | warning | **[W07]** a geometry file exists in the package but is not referenced by the manifest `geometry` list (usually a forgotten entry — §6.9). "Geometry file" is decided by **content, not extension**: a file is one if the §7 reader accepts it. Since v0.9 the manifest, palette files and animation clips are all `.json` too, so an extension test would flag every one of them |
| `unknown` | warning | Animation targets a part not present in `cuboidy.json` `parts` (cross-rig sharing, §6.8) |
| `unknown` | runtime error | Attempt to attach to a socket name not declared on the host part (planned) |

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
     coordinate that is not a triple); a palette with more than 62 colors, or
     an inline palette with none
   - **`invalid-value`** — right shape, wrong content: a malformed color, a
     `size` dimension outside `[1..1024]` or non-integer, a voxel row
     containing a character outside `[.0-9a-zA-Z]`, an identifier failing §5,
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
   across geometry files, manifest↔geometry agreement, palette resolution and
   the index ranges phase 3 deferred.

Where several violations coexist *within* one phase, which is reported is
implementation-defined; every shared fixture holds exactly one error, so parity
does not depend on that choice. Reporting a violation from a **later** phase
than one that is also present is non-conforming, because it means an earlier
check did not run.

---

## 12. Reference examples

The reference repository includes:

- `models/knight/` — multi-part rigged humanoid over three geometry files sharing one palette, with a walk clip and sockets (`grip`, `crest`)
- `models/sword/` — single-part static accessory, designed to attach to `knight` via the `hand-r:grip` socket
- `models/owl/`, `models/koi/`, `models/fox/` — non-humanoid rigs (segmented wings, a body chain, a quadruped gait)
- `models/windmill/` — a `geometry` list plus a shared palette file, and two constant-rate rotations in one clip

All reference examples pass the current lint rules at error level.

---

## 13. Future extensions (out of scope for v0.9)

- **Packed format**: `<name>.cuboidy` (ZIP archive of the package)
- **Named palette colors / metadata**: the palette file's object form (§6.10) reserves the room
- **Multi-character palette encoding**: 2-character indices for palettes larger than 62
- **Animation blending**: simultaneous animations with weighted contribution
- **Custom easing curves**: cubic-bezier control points beyond the §6.7 named presets
- **Standardized rig vocabularies**: humanoid / quadruped / biped contracts (analogous to VRM humanoid spec)
- **Inverse kinematics**: solver-driven part chains
- **Attachment**, and it is the largest gap in the current draft. §7.8 defines a socket's position and orientation precisely, and §11.6 already reserves a runtime error for attaching to a socket that does not exist — but nothing in the format can state *that* an attachment happens. A package can declare `hand-r:grip`; it cannot record that a particular sword belongs in it. A specification needs to define the asset reference, the host part and socket it binds to, the behaviour when that socket does not resolve, whether the guest inherits the host's animation, and how palettes scope across the join. Until then a socket is a coordinate that an external runtime must be told what to do with, and two packages that fit together can only be shown to fit by merging them by hand.
- **Per-attachment overrides**: rotation / scale offsets, once attachment itself is specified

---

## 14. Acknowledgments

Cuboidy's design draws from prior work in voxel and rigging formats:
Minecraft Bedrock Edition, Mixamo, MagicaVoxel, VRM, glTF, Pixar USD.

---

*End of specification.*
