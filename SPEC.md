# Cuboidy Format Specification

**Version:** 0.2 (draft)
**Status:** Early draft. Subject to change before v1.0.

**Changes since v0.1:** Comments (`//`) added. Declaration order is fully free at all levels (palette / parts / metadata / layer indices). Voxel-row separator is any whitespace including newlines — the entire file (after `//` comment stripping) is a single token stream, so `size\n3\n2\n3` is equivalent to `size 3 2 3`. New error codes E15 / E16 / E17 / E19 added; E09 narrowed (out-of-order is no longer an error).

---

## 1. Overview

Cuboidy is a text-based open file format for voxel character models with rigged parts, named attachment sockets, and shareable keyframe animations.

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
| **Manifest** | `cuboidy.json` — rig hierarchy and animations |
| **Voxel definition** | `voxels.cvox` — shape, palette, pivot, sockets |
| **Packed Cuboidy** | `<name>.cuboidy` — ZIP archive of the package (reserved; not specified in v0.1) |
| **Part** | A rigid voxel sub-object, optionally parented in the hierarchy |
| **Socket** | A named attachment point on a part |
| **Keyframe** | A time-indexed pose snapshot for an animated part |
| **Rest pose** | A part's pose when no animation is active: position = `part.position` (in parent space), rotation = the part's `pivot.rot` if present (around `pivot.pos`), else identity, scale = `[1,1,1]` |

---

## 3. Folder structure

A Cuboidy model is stored as a folder. The folder's name is conventional and not authoritative; the manifest's `name` field is.

```
my-model/
├── cuboidy.json           required — manifest
├── voxels.cvox          required — voxel definition
└── anims/               optional — shared / external animation files
    ├── walk.json
    └── idle.json
```

Files not referenced from the manifest and not `cuboidy.json` / `voxels.cvox` are ignored. The `anims/` subfolder is conventional; animation files may live anywhere in the package.

---

## 4. Coordinate system

Cuboidy uses a **right-handed coordinate system**:

- **+X**: model's right
- **+Y**: up
- **−Z**: forward (the direction the model faces)

This matches glTF, USD, Blender, and Three.js. Unity-based consumers negate the Z axis on load.

Rotations are **Euler angles in degrees**, applied in **ZXY intrinsic order** (the convention used by Unity's Inspector).

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
  "version": "0.2",
  "parts": [ ... ],
  "animations": { ... }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Model identifier |
| `version` | no | string | Spec version this model targets. Absent → `"0.2"` |
| `parts` | **yes** | array (non-empty) | At least one part |
| `animations` | no | object | Map from animation name to definition. Absent → no animations |

### 6.2 Part object

```json
{
  "name": "<identifier>",
  "parent": "<identifier>",
  "position": [x, y, z]
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Unique within model |
| `parent` | no | string (identifier) | Another part's name. Absent → this part is a root |
| `position` | no | `[number, number, number]` | Where this part's pivot sits in parent space (voxel units). Default `[0, 0, 0]` |

Rules:

- Multiple root parts (parts with no `parent`) are permitted.
- The `parts` array may be in any order; the parser resolves the hierarchy in a second pass.
- `parent` must refer to another part in the same model.
- Cycles in the parent chain are an error.

Per-part shape, pivot, and sockets live in `voxels.cvox`, not here. See §7.

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
      "<time-key>": { "rot": [...], "pos": [...], "scale": [...], "visible": ... },
      ...
    },
    ...
  }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `duration` | **yes** | number | Animation length in seconds. Must be ≥ the largest time key |
| `loop` | **yes** | bool | If `true`, animation restarts seamlessly after `duration` |
| `parts` | **yes** | object | Map from part name to keyframe sequence. May be empty (no part animates) |

### 6.5 Keyframe values

| Field | Type | Interpretation | Default at first keyframe |
|---|---|---|---|
| `rot` | `[rx, ry, rz]` Euler degrees | **Relative** to rest pose rotation (the part's `pivot.rot` if present, else identity). Composed with `pivot.rot` as described in §7.7 | `[0, 0, 0]` |
| `pos` | `[dx, dy, dz]` voxel units | **Delta** added to `part.position` | `[0, 0, 0]` |
| `scale` | `[sx, sy, sz]` multipliers | **Multiplier** from rest scale (`[1,1,1]`). Per-axis, non-uniform allowed | `[1, 1, 1]` |
| `visible` | bool | Visibility toggle | `true` |

#### Carryover

In a part's keyframe sequence, **any field omitted from a keyframe inherits its value from the previous keyframe** for that part. The first keyframe's defaults are listed above.

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

- `rot`, `pos`, `scale` are **linearly interpolated**
- `visible` uses **step** interpolation: the value at the later keyframe takes effect at that keyframe's time

Custom easing curves are reserved for future spec versions.

### 6.8 Missing parts

If an animation's `parts` includes a name that does not exist in this model, the reference is **silently skipped at runtime** (with a warning at lint time).

This rule supports cross-rig sharing: a shared `quadruped_walk.json` that animates `leg-fl, leg-fr, leg-bl, leg-br` works on a 3-legged variant; the missing leg simply does nothing.

### 6.9 Concurrency

A model may have at most **one active animation** at a time. Blending, layering, and per-part overlays are reserved for future spec versions.

---

## 7. `voxels.cvox` — voxel definition

A plain-text file with a line-oriented grammar.

### 7.1 Token stream

After per-line `//` comment stripping (see §7.11), the file is treated as a **single token stream** separated by any whitespace — spaces, tabs, and newlines all serve as token separators. Newlines have no syntactic significance outside of comment scope.

Each token is one of:

| Token | Pattern | Example |
|---|---|---|
| **Reserved keyword** | `palette`, `part`, `size`, `pivot`, `socket`, `layer` (and the contextual sub-keyword `rot` after a `pivot` or `socket` position triple) | `size` |
| **Color literal** | `#` followed by 3, 4, 6, or 8 hex digits | `#8B4513` |
| **Identifier** | `[a-zA-Z_][a-zA-Z0-9_-]*` | `head`, `leg-fl` |
| **Number** | integer or decimal, optional leading `-` | `3`, `1.5`, `-2` |
| **Voxel row** | `[.0-9a-zA-Z]+` of length `W` (per the enclosing part's `size`) | `000`, `0.0`, `101` |

A token's role is determined by **context**, not lexical shape alone: the same characters can be an identifier, a number, or a voxel-row token depending on where they appear in the stream. The parser is recursive-descent: each keyword consumes a fixed number of subsequent tokens (or, for `layer`, voxel-row tokens until the next keyword).

Consequence: `size 3 3 3` and `size\n3\n3\n3` are equivalent input. `part crown` and `part\ncrown` are equivalent. `layer 0  000  000  000` and `layer 0\n000\n000\n000` and any mixture all yield the same parsed model. Indentation has no semantic meaning; it is purely a readability convention.

**Declaration order is free at every level:** the `palette` declaration may appear anywhere in the file; part declarations may appear in any order; within a part, the `size`, `pivot`, `socket`, and `layer` declarations may appear in any order; and `layer N` blocks may declare their indices in any order, provided the full range `0..H-1` is covered exactly once.

Readers MUST accept any order and any whitespace shape. Writers (e.g. the editor's serializer) SHOULD normalize to a canonical form: palette first, parts in manifest order, metadata in `size → pivot → socket → layer` order, layers by index, each keyword on its own line with arguments on the same line, four-space indent under `part`. This is the "be liberal in what you accept, conservative in what you produce" pattern.

### 7.2 Grammar

The grammar is given informally because element order within `file` and within `part` is unconstrained. A formal LL(1) grammar would force order; the actual rule is "a `part` block contains exactly one `size`, at most one `pivot`, zero or more `socket`, and exactly `H` `layer` blocks, in any order; the file contains exactly one `palette` and one or more `part` blocks, in any order."

```
file        := (palette-decl | part)+        (palette-decl appears exactly once;
                                              part appears 1 or more times;
                                              any interleaving permitted)
palette-decl := "palette" (SPACE color)+
color       := "#" (3 | 4 | 6 | 8) hex-digits

part        := "part" SPACE identifier
               (size-decl | pivot-decl | socket-decl | layer)+
                                              (any order; size exactly once;
                                               pivot at most once; sockets any count;
                                               layers exactly H)

size-decl   := "size" SPACE int SPACE int SPACE int
pivot-decl  := "pivot" SPACE num SPACE num SPACE num
                (SPACE "rot" SPACE num SPACE num SPACE num)?
socket-decl := "socket" SPACE identifier SPACE num SPACE num SPACE num
                (SPACE "rot" SPACE num SPACE num SPACE num)?

layer       := layer-header (SPACE voxel-row)* (NEWLINE voxel-row)*
                                              (rows may appear inline after the
                                               layer header, on subsequent lines, or
                                               mixed; total row count must equal D)
layer-header := "layer" SPACE non-negative-integer
voxel-row   := /[.0-9a-zA-Z]+/
```

All metadata keywords are **2 characters or longer**. This rule reserves single-character lines for voxel data and prevents palette-index collisions with future keywords.

### 7.3 Reserved keywords (v0.2)

- `palette`
- `part`
- `size`
- `pivot`
- `socket`
- `layer`

`rot` is a **contextual sub-keyword** recognized only inside `pivot` and `socket` declarations as the marker that introduces a rotation triple. Outside those contexts, `rot` is a normal voxel-row token (e.g. it can appear in voxel data on a palette with at least 30 colors), an identifier, or whatever the position in the grammar dictates. It is intentionally NOT in the top-level reserved-keyword set, so it does not interrupt the active layer's row collection (§7.9).

An unrecognized top-level token — neither a reserved keyword above nor a voxel-row-shape token continuing an active layer — is E04.

### 7.4 Palette declaration

```
palette <color>+
```

- **Exactly one** palette declaration per file (more is E15)
- May appear **anywhere** in the file — before, between, or after part declarations
- Each color in hex: `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`
- Color space: **sRGB**
- Maximum **62 colors** (palette indices `0..61`; more is E16)
- Voxel data references colors by single character:
  - `0`–`9` → palette indices 0–9
  - `a`–`z` → palette indices 10–35
  - `A`–`Z` → palette indices 36–61
- The character `.` is reserved for empty space (air) and is **not** part of the palette

Position-based indexing: reordering the palette requires rewriting voxel data. Tooling can automate this.

When voxel rows are parsed before the palette is known (because palette appears later in the file), palette-index validation (E11) is deferred until file assembly completes.

### 7.5 `part` declaration

```
part <identifier>
```

Starts a new part section. The parser detects new parts by this keyword; there is no explicit part-end marker. A part section ends at the next `part` keyword or at end of file. The `palette` declaration is file-level, not part-level — it may appear inside the textual span of a part section without ending it.

A `part` section must contain:

| Element | Cardinality | Notes |
|---|---|---|
| `size` | **exactly 1** | Missing → E13. Duplicate → E17 |
| `pivot` | at most 1 | Duplicate → E17 |
| `socket` | 0 or more | Duplicate names → E14 |
| `layer N` | **exactly H** (covering 0..H-1) | Missing or duplicated index → E09 |

**Order is free.** Any permutation of these elements within a part is valid. Writers should normalize to `size → pivot → socket* → layer*` (with layers sorted by index) for diff stability.

### 7.6 `size`

```
size <W> <H> <D>
```

- W = X-axis width, H = Y-axis height, D = Z-axis depth
- All values are positive integers in the range `[1, 1024]` per axis (zero or negative values, fractions, and values exceeding 1024 are E17)
- Total voxel cells = W × H × D
- The 1024 cap is a sanity bound to keep validation and rendering tractable; future spec versions may relax it

### 7.7 `pivot`

```
pivot <x> <y> <z>
pivot <x> <y> <z> rot <rx> <ry> <rz>
```

- Optional. Default: position bottom-center, `[W/2, 0, D/2]`; rotation absent (identity)
- Position coordinates in **part-local space**, voxel units; may be fractional; may lie outside the grid bounds (W01 lint warning, not error)
- Optional rotation: 3 Euler angles in degrees, ZXY intrinsic order (§4), introduced by the contextual sub-keyword `rot`
- **Semantic** (interpretation A — Rest pose rotation): when an animation is not active, the part is rendered with this rotation applied around its pivot position. When an animation is active, the animated rotation is composed with the pivot rotation. Using matrix-vector convention with column vectors, a part-local point `v_local` lands at `v_parent = part.position + pivot.pos + M_pivot · M_anim · (v_local − pivot.pos)`, where `M_pivot` and `M_anim` are the rotation matrices for `pivot.rot` and the animated keyframe rotation. Equivalently in quaternion form: `q_total = q_pivot · q_anim` (the animation rotation is applied first, in the rest-pose-local frame, then the pivot rotation brings it to the rest orientation)
- Two arities are valid at the library-level `parsePivot(args)` API: 3 args (position only) or 7 args (position + `rot` + rotation). 4–6 or 8+ args is E05; 7 args without the `rot` marker as the 4th token is E05
- Under integrated `parseCvox()` parsing of the token stream, the parser consumes exactly 3 tokens (then 3 more iff the next token is `rot`). Tokens beyond that boundary are not stolen by the pivot declaration — they fall through to the main token loop, where they are diagnosed by §11.8 (typically E10 if voxel-row shape, E04 if non-row-shape, both raised in the absence of an active layer). A user writing `pivot 1 0 1 5` will therefore see E10 or E04, not E05; the library-level `parsePivot()` is the entry point that enforces strict arity

### 7.8 `socket`

```
socket <identifier> <x> <y> <z>
socket <identifier> <x> <y> <z> rot <rx> <ry> <rz>
```

- Zero or more per part
- Position in part-local space, voxel units (fractional allowed)
- Optional rotation: Euler degrees, ZXY order, default `[0, 0, 0]`
- Socket name unique within a part

### 7.9 `layer`

```
layer <N>
layer <N> <row>+
```

- Marks voxel data for Y-layer index `N` (0-based, non-negative integer in range `[0, H-1]`; out-of-range or duplicate is E09)
- A part must contain exactly H `layer` blocks covering indices `0..H-1` exactly once
- **Index order is free** — `layer 2`, `layer 0`, `layer 1` is valid
- After the `N` token, the parser collects voxel-row tokens into the **active layer** until the next reserved keyword (`palette`, `part`, `size`, `pivot`, `socket`, `layer`) or end of file
- Each layer must accumulate exactly D voxel-row tokens; assembly-time validation reports E10 otherwise. Whitespace between row tokens — spaces, tabs, or newlines — is interchangeable, so the same D tokens can be written inline, on separate lines, or mixed
- The k-th row (in token order) represents voxel cells at coordinates `(x, N, k)` for `x ∈ 0..W-1`
- A voxel-row-shape token (`[.0-9a-zA-Z]+`) encountered while no active layer is open is E10 ("voxel row outside any layer")

### 7.10 Voxel row

- Characters drawn from `[.0-9a-zA-Z]`, no whitespace inside a single row token
- Length exactly equals W
- Each character is either `.` (air) or a palette index character (must be within the declared palette range)
- Multiple row tokens on a single line are separated by whitespace; either spaces or a newline serves as the separator

### 7.11 Comments

```
// this is a full-line comment
size 3 3 3  // this is an end-of-line comment
```

- A `//` sequence anywhere on a line starts a comment; the comment extends to the end of that line
- No whitespace context is required around `//`; the `/` character does not appear in any valid Cuboidy token (voxel-row chars `[.0-9a-zA-Z]`, identifiers, hex digits, numeric literals), so `//` cannot collide with data
- Note: color literals (`#FFFFFF`) use `#`, not `//`, and are unrelated to comments
- Comments are stripped before line classification (§7.1) and have no semantic effect
- Writers (the canonical serializer) SHOULD preserve comments verbatim across read/write round-trips, attaching each comment to its enclosing structural element (file header, palette, part, metadata line, layer)

### 7.12 Examples

**Multi-line layer style (compact for visual voxel art):**

```
palette #8B4513 #000000

part head
    size 3 3 3
    pivot 1 0 1
    socket hat 1 3 1
    socket mouth 1 1 3
    layer 0
        000
        000
        000
    layer 1
        000
        000
        101
    layer 2
        000
        000
        000
```

**Inline layer style (compact for small parts and AI generation):**

```
// crown — single part static accessory
palette #FFD700

part crown
    size 3 2 3
    pivot 1 0 1
    layer 0  000 000 000
    layer 1  0.0 ... 0.0
```

**Free-order example (palette at end, layers out of index order):**

```
part body
    size 1 2 1
    layer 1  0      // top
    layer 0  0      // bottom

palette #FF0000
```

All three are valid Cuboidy v0.2 input and demonstrate three different syntactic styles. They describe different models (head / crown / body), not the same model in three notations.

---

## 8. Reference paths

Used by `animations` string values (and any future reference fields).

Rules:

- Resolved **relative to the file containing the reference** (typically `cuboidy.json`)
- Must end in `.json` (explicit extension required)
- Forward slashes `/` only
- Absolute paths (leading `/`) are forbidden
- URLs (`http://`, `https://`, `file://`) are forbidden
- `namespace:key` URIs are forbidden (the format has no registry)

Examples (assuming reference is from `wolf/cuboidy.json`):

| Path | Resolves to |
|---|---|
| `anims/walk.json` | `wolf/anims/walk.json` |
| `./anims/walk.json` | `wolf/anims/walk.json` |
| `../shared/walk.json` | `shared/walk.json` |

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
| `cuboidy.json` | part `parent` | absent → root |
| `cuboidy.json` | `animations` | absent → no animations |
| `cuboidy.json` | `version` | absent → `"0.2"` |
| Keyframe (first) | `rot` | `[0, 0, 0]` |
| Keyframe (first) | `pos` | `[0, 0, 0]` |
| Keyframe (first) | `scale` | `[1, 1, 1]` |
| Keyframe (first) | `visible` | `true` |
| Keyframe (subsequent) | any omitted field | inherits from previous keyframe |
| `voxels.cvox` | `pivot` | `[W/2, 0, D/2]` (bottom-center) |
| `voxels.cvox` | socket rotation | `[0, 0, 0]` |

---

## 11. Validation & lint

A Cuboidy package is **well-formed** if it passes all error-level rules.

### 11.1 Severity levels

| Level | Meaning | Implementation behavior |
|---|---|---|
| **Error** (`E`/`C`/`X`) | Spec violation | Refuse to load (or recover only on explicit request) |
| **Warning** (`W`) | Spec-valid but suspicious | Load with warning emitted |
| **Hint** (`H`) | Style or convention | Load with hint emitted |

### 11.2 `voxels.cvox` errors

| ID | Rule |
|---|---|
| E01 | Missing `palette` declaration |
| E02 | Invalid palette color format |
| E03 | Invalid `part` header (missing or non-identifier name) |
| E04 | Unknown metadata keyword |
| E05 | Invalid `pivot` arguments (count or value) |
| E06 | Invalid `socket` arguments |
| E07 | Voxel row contains a character outside `[.0-9a-zA-Z]` |
| E08 | Voxel row width does not match declared `W` |
| E09 | Layer index out of range `[0..H-1]`, or duplicated within a part |
| E10 | Wrong number of voxel rows in a layer (must be exactly `D`) |
| E11 | Voxel character references a palette index outside the declared palette |
| E12 | Duplicate `part` name within file |
| E13 | Missing `size` for a part |
| E14 | Duplicate socket name within a part |
| E15 | Duplicate `palette` declaration |
| E16 | Palette exceeds 62-color maximum |
| E17 | Invalid arguments to a metadata or top-level declaration (wrong count, non-numeric where number expected, out-of-range value such as `size` dimension `0` or `> 1024`, or duplicate `size`/`pivot` within a part) |
| E19 | File contains a `palette` but zero `part` declarations |

Note: in v0.1, palette overflow and duplicate palette were folded into E02; invalid `size`/`layer` argument shapes were folded into E13/E09; declaration-order violations had no dedicated code. v0.2 separates these into E15 / E16 / E17, and removes the order-violation case entirely (order is now free).

### 11.3 `voxels.cvox` warnings

| ID | Rule |
|---|---|
| W01 | Pivot outside voxel grid bounds |
| W02 | Socket outside voxel grid bounds |
| W03 | Palette index declared but never used |
| W04 | Layer entirely empty (all `.`) |
| W05 | Part has no solid voxels (all `.`) |

### 11.4 `voxels.cvox` hints

| ID | Rule |
|---|---|
| H01 | Part name violates `lower_snake_case` or `lower-kebab-case` convention |
| H02 | Pivot uses fractional value in an otherwise integer-aligned grid |

### 11.5 `cuboidy.json` errors

| ID | Rule |
|---|---|
| C01 | Missing top-level `name` |
| C02 | `parts` is empty or absent |
| C03 | Part `parent` references a non-existent part |
| C04 | Parent chain contains a cycle |
| C05 | Animation `duration` is less than the largest time key |
| C06 | An animated part's time keys do not start at `"0.0"` |
| C07 | Time keys not strictly increasing |
| C08 | External animation reference path does not end in `.json` |
| C09 | External animation reference uses absolute path, URL, or namespace URI |
| C10 | External animation references form a cycle |
| C11 | Duplicate part name |
| C12 | Duplicate animation name |
| C13 | Unknown field encountered (warning by default; can be promoted to error) |

### 11.6 Cross-file rules

| ID | Severity | Rule |
|---|---|---|
| X01 | error | `cuboidy.json` references a part name not defined in `voxels.cvox` |
| X02 | warning | `voxels.cvox` defines a part not listed in `cuboidy.json` `parts` |
| X03 | warning | Animation targets a part not present in `cuboidy.json` `parts` (cross-rig sharing) |
| X04 | runtime error | Attempt to attach to a socket name not declared on the host part |

### 11.7 Diagnostic format

Implementations should emit diagnostics in the form:

```
<file>:<line>[:<col>]: <severity>: <message> [<rule-id>]
```

Example:

```
voxels.cvox:5:1: error: row width 4, expected 3 (per `size 3 2 4`) [E08]
voxels.cvox:12: warning: pivot [3, 0, 5] outside grid bounds [0..3, 0..3, 0..4] [W01]
cuboidy.json:18: error: animation 'walk' targets part 'wing' not in model [X01]
```

This format is gcc / clang compatible for IDE integration.

### 11.8 Error precedence

When a single input could match more than one error (common under v0.2 free-order rules), implementations MUST report **the first error encountered during a single forward pass over the token stream**, with errors raised during assembly (after all tokens are consumed) coming after all stream-pass errors.

Concrete precedence:

1. Per-line comment stripping (no errors possible).
2. Tokenization (no errors possible; any non-whitespace sequence is a token).
3. Token-stream forward pass:
   - E15 (duplicate palette declaration)
   - E16 (palette overflow)
   - E02 (palette color format), E03 (part header), E05 (pivot args), E06 (socket args), E17 (size / layer / palette args)
   - E12 (duplicate part name)
   - E14 (duplicate socket within a part)
   - E09 (duplicate layer index within a part)
   - **E07** (non-keyword token whose characters fall outside `[.0-9a-zA-Z]` while an active layer is open — the token cannot be a row but is appearing in row context)
   - **E10** (voxel-row-shape token with no active layer open)
   - **E04** (non-keyword, non-voxel-row-shape token with no active layer open — no row context to belong to)
4. End-of-stream assembly:
   - E01 (missing palette), E19 (palette but no parts)
   - E13 (missing size for a part)
   - E09 (layer coverage: missing index or index out of range)
   - E10 (layer row count mismatch with D)
   - E08 (voxel row width mismatch with W) and E11 (palette index out of range), both raised when individual rows are validated against `size` and `palette` at assembly time

A conformant implementation that reports a different error than this precedence implies is non-conforming for cross-implementation parity testing, but its output is still useful to the user.

---

## 12. Reference examples

The reference repository includes:

- `wolf/` — three-part rigged model (body / head / tail) with idle animation and sockets (`hat`, `mouth`)
- `crown/` — single-part static accessory designed to attach to `wolf` via the `head:hat` socket

Both pass all v0.2 lint rules at error level.

---

## 13. Future extensions (out of scope for v0.2)

- **Packed format**: `<name>.cuboidy` (ZIP archive of the package)
- **External palette references**: share palettes across models, avoiding per-model duplication
- **Multi-character palette encoding**: 2-character indices for palettes larger than 62
- **Animation blending**: simultaneous animations with weighted contribution
- **Animation easing**: per-keyframe interpolation curves beyond linear
- **Standardized rig vocabularies**: humanoid / quadruped / biped contracts (analogous to VRM humanoid spec)
- **Inverse kinematics**: solver-driven part chains
- **Per-attachment overrides**: rotation / scale offsets when attaching accessories to sockets
- **JSON-style comments in `cuboidy.json`**: JSON itself does not support comments; a side-car or JSON5-style extension is under discussion

---

## 14. Acknowledgments

Cuboidy's design draws from prior work in voxel and rigging formats:
Minecraft Bedrock Edition, Mixamo, MagicaVoxel, VRM, glTF, Pixar USD.

---

*End of specification.*
