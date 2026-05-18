# Cuboidy Format Specification

**Version:** 0.3 (draft)
**Status:** Early draft. Subject to change before v1.0.

**Changes since v0.2:** Voxel data is now wrapped in a **`voxels { … }` block** with `,` separating layers — this replaces the v0.2 `layer N` keyword and resolves the systemic ambiguity where a voxel-row token spelling a reserved word (e.g. `rot`, `size`, `part`) could collide with grammar. Lexical scoping is reframed as a two-layer model (universal `{` `}` `//` whitespace + context-scoped reserved words); each block-introducing keyword decides what is reserved inside its `{ … }`. The `voxels` block reserves nothing — so any voxel-row character sequence is unambiguously voxel data. The `rot` keyword is no longer a "sub-keyword" but a normal reserved word with **structural validity constrained to `pivot` / `socket` declarations**. Free-order layer indices are dropped (positional now); free-order for `palette` / `part` / `size` / `pivot` / `socket` / `voxels` within their respective scopes is retained.

**Changes since v0.1:** Comments (`//`) added. Declaration order is free for palette / parts / metadata. Token separator is any whitespace including newlines — the entire file (after `//` comment stripping) is a single token stream, so `size\n3\n2\n3` is equivalent to `size 3 2 3`. Pivot may carry an optional rotation (`pivot x y z rot rx ry rz`). **Diagnostic codes are restructured around 5 structural categories** (`missing` / `duplicate` / `unknown` / `invalid-value` / `wrong-arity`); the v0.1 keyword-centric Exx / Cxx / Xxx codes are removed.

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
| **Packed Cuboidy** | `<name>.cuboidy` — ZIP archive of the package (reserved; not specified in v0.3) |
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
  "version": "0.3",
  "parts": [ ... ],
  "animations": { ... }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | **yes** | string (identifier) | Model identifier |
| `version` | no | string | Spec version this model targets. Absent → `"0.3"` |
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

A plain-text file. Lexing uses a two-layer model (§7.1), parsing is recursive-descent on a single token stream (§7.2).

### 7.1 Lexical structure

Cuboidy's lexer recognizes one unified category — **reserved tokens** — split by syntactic shape into two sub-categories. Both stop argument collection (§7.2), neither participates in identifier slots, and together they are the only tokens with grammatical significance outside of voxel data.

**Reserved punctuation — universal scope** (always recognized as 1-character tokens, anywhere in the file):

| Token | Role | Need surrounding whitespace? |
|---|---|---|
| `{` | open a `voxels` block | no — `voxels{` tokenizes as `voxels` + `{` |
| `}` | close a `voxels` block | no — `},` tokenizes as `}` + `,` |
| `,` | layer-section separator inside a `voxels` block | no — `0,0` tokenizes as `0` + `,` + `0` |

These three tokens are **always significant**, including inside a `voxels { … }` block. They never appear inside another token (none of them is in the voxel-cell character set `[.0-9a-zA-Z]`), so they cannot collide with voxel data.

**Reserved keywords — context-scoped** (the full set is flat — 7 words — but each is only recognized as a *statement-starting keyword* in a specific scope; full structural validity table in §7.3):

| Scope | Statement-starting keywords recognized here | Other lexical features |
|---|---|---|
| **top-level** (outside any `{ … }`) | `palette`, `part` | `#` introduces a color literal (palette arg) |
| **`part` section** (between a `part` keyword and the next `part` or end of file) | `size`, `pivot`, `socket`, `voxels` (and `palette`, which is file-level but may appear textually here without closing the part — see §7.5) | — |
| **`pivot` / `socket` declaration** (after the position triple) | `rot` (optional, introduces a rotation triple) | — |
| **`voxels { … }` block** | **(none)** — alphabetic reserved keywords have no lexical privilege here; every token except the reserved punctuation `,` `}` is interpreted as a voxel-row string | — |

**Non-tokenized lexical primitives** (also universal, but never produce tokens):

| Element | Behavior |
|---|---|
| whitespace (space, tab, newline) | token separator; no syntactic significance |
| `//` … end-of-line | comment, stripped before tokenization |

**Lexical vs structural — two separate axes.** The set of *lexical* reserved tokens is fixed (7 keywords + 3 punctuation). What changes by scope is *structural validity* — which reserved token can appear here and what role it plays. A reserved token never participates in identifier slots: the parser collects arguments to a keyword until the next reserved token (§7.2), so `part rot` does not name a part `rot` — it fails as a `part` header with 0 identifier arguments. To put a string spelled like a reserved keyword into the model, place it inside a `voxels { … }` block where alphabetic keywords have no lexical privilege. (The 3 reserved punctuation tokens never decay into voxel-row strings, however, because their characters fall outside `[.0-9a-zA-Z]`.)

The framework generalizes naturally: each block-introducing keyword (currently `voxels`; future versions may add more) decides what is reserved inside its `{ … }`. The `voxels` keyword reserves no alphabetic keywords — so alphabetic reserved keywords from other scopes appearing inside `voxels { … }` are simply voxel-row strings.

**Consequence — voxel data is lexically isolated:** a row written as `rot` or `size` or `part` is unambiguously voxel data. The user-visible rule is "alphabetic reserved keywords live outside `voxels { … }`; inside, anything goes — except the 3 reserved punctuation tokens, which always retain their structural role".

### 7.1.1 Token table

| Token | Pattern | Example |
|---|---|---|
| **Reserved keyword** | one of `palette`, `part`, `size`, `pivot`, `socket`, `voxels`, `rot` (per §7.1 scope rules) | `voxels` |
| **Reserved punctuation** | `{` `}` `,` (always 1-character tokens, universal scope) | `{` |
| **Color literal** | `#` followed by 3, 4, 6, or 8 hex digits | `#8B4513` |
| **Identifier** | `[a-zA-Z_][a-zA-Z0-9_-]*` | `head`, `leg-fl` |
| **Number** | integer or decimal, optional leading `-` | `3`, `1.5`, `-2` |
| **Voxel row** | `[.0-9a-zA-Z]+` (only inside `voxels { … }`; length must equal `W`) | `000`, `0.0`, `101` |

A token's role is determined by its **scope** (§7.1) and **position** (§7.2 grammar). The same character sequence may be an identifier in one scope and a voxel-row string in another.

Consequence: `size 3 3 3` and `size\n3\n3\n3` are equivalent input. `part crown` and `part\ncrown` are equivalent. Inside `voxels { … }`, rows can be inline, multi-line, or mixed. Indentation has no semantic meaning; it is purely a readability convention.

**Declaration order is free within each scope:** at top-level, `palette` and `part` declarations may appear in any order; within a `part`, the `size`, `pivot`, `socket`, and `voxels` declarations may appear in any order. **Layer indices inside a `voxels` block are positional** — the first comma-separated section is layer 0, the second is layer 1, etc.

Readers MUST accept any order and any whitespace shape. Writers (e.g. the editor's serializer) SHOULD normalize to a canonical form: palette first, parts in manifest order, metadata in `size → pivot → socket → voxels` order, each keyword on its own line with arguments on the same line, four-space indent under `part`, layers separated by `,` on its own line. This is the "be liberal in what you accept, conservative in what you produce" pattern.

### 7.2 Grammar

The grammar is given informally because element order is unconstrained within each scope. The actual rules are: the file contains exactly one `palette` and one or more `part` blocks, in any order; a `part` contains exactly one `size`, exactly one `voxels`, at most one `pivot`, and zero or more `socket` declarations, in any order.

```
file         := (palette-decl | part)+        (palette-decl appears exactly once;
                                              part appears 1 or more times;
                                              any interleaving permitted)
palette-decl := "palette" color+
color        := "#" (3 | 4 | 6 | 8) hex-digits

part         := "part" identifier
                (size-decl | pivot-decl | socket-decl | voxels-block)+
                                              (any order; size exactly once;
                                               voxels exactly once;
                                               pivot at most once;
                                               sockets any count)

size-decl    := "size" int int int
pivot-decl   := "pivot" num num num ("rot" num num num)?
socket-decl  := "socket" identifier num num num ("rot" num num num)?

voxels-block := "voxels" "{" layer-section ("," layer-section)* "}"
layer-section := voxel-row*                   (exactly D rows per layer-section;
                                              the i-th layer-section is layer i;
                                              total layer-section count must equal H)
voxel-row    := /[.0-9a-zA-Z]+/               (length must equal W;
                                              chars are palette indices or `.`=air;
                                              all reserved-word strings are valid
                                              voxel-row tokens inside `voxels { … }`)
```

Tokens are separated by any whitespace (space, tab, newline) or by the reserved punctuation `{` `}` `,` (which need no surrounding whitespace).

**Argument collection rule (Postel reader semantics).** When the integrated parser is reading arguments to a keyword (`palette` colors, `part` identifier, `size` ints, `pivot` / `socket` nums, `voxels` opening `{`), it pulls tokens from the stream **until the next reserved token** — keyword or punctuation, whichever comes first. The library-level entry points (`parsePart(args)`, `parseSize(args)`, etc.) receive whatever slice was pulled and validate strict arity:

- If the pulled count is less than required, the library returns `wrong-arity`.
- If the pulled count is more than required, the library returns `wrong-arity` (library entry only).
- Under the integrated parser, the keyword consumes only its required count; extras stay in the stream and are diagnosed by the main loop at the next iteration (typically `unknown` for a stray identifier, `invalid-value` for a stray number where no statement is expected). This is documented per-keyword in §7.5–§7.9.

Concretely: `part rot` pulls 0 identifier tokens (because `rot` is reserved and stops collection), so `parsePart([])` returns `wrong-arity`. `size 1 1 1 9` pulls 3 ints, sets the size, and leaves `9` for the main loop to diagnose as `unknown`. This rule is what makes "reserved tokens are not valid identifiers" an automatic consequence of the lexer.

**`palette` mid-part.** The `palette` keyword is file-level (§7.5): it may appear anywhere in the file, including inside the textual span of a `part` section. It does **not** close the surrounding part — the part remains open after the `palette` declaration is consumed. The grammar above shows `part := "part" identifier (size-decl | pivot-decl | socket-decl | voxels-block)+`, but a reader MUST accept a `palette-decl` interleaved into that sequence without closing the part. This special-case applies only to `palette`; all other top-level statement starters (`part`) close the surrounding part.

### 7.3 Reserved tokens (v0.3)

The reserved-token set is **flat** — there is no concept of "sub-keyword". It has two sub-categories distinguished only by syntactic shape; both share the property "stops argument collection (§7.2) and never appears in an identifier slot".

#### 7.3.1 Reserved keywords (7, alphabetic)

```
palette  part  size  pivot  socket  voxels  rot
```

#### 7.3.2 Reserved punctuation (3, symbol)

```
{   }   ,
```

#### 7.3.3 Structural validity

Each reserved token has a single structurally valid position. Outside that position it is reported as `missing` (the required enclosing scope is absent).

| Token | Structurally valid in |
|---|---|
| `palette` | top-level (exactly once per file) |
| `part` | top-level |
| `size` | within a `part` section (exactly once per part) |
| `pivot` | within a `part` section (at most once per part) |
| `socket` | within a `part` section (any count) |
| `voxels` | within a `part` section (exactly once per part) |
| `rot` | inside a `pivot` or `socket` declaration, immediately after the position triple |
| `{` | immediately after the `voxels` keyword (opens a voxels block) |
| `}` | inside a voxels block (closes it) |
| `,` | inside a voxels block (separates layer-sections) |

#### 7.3.4 Lexical privilege inside `voxels { … }`

Inside a `voxels { … }` block, the **alphabetic reserved keywords lose their lexical privilege** — they are interpreted as voxel-row strings and validated against row-width and palette-index rules. A row spelling `rot`, `size`, or `part` is well-formed voxel data when the palette indices fall within range.

The **3 reserved punctuation tokens retain their structural role inside the block**: `}` always closes the block, `,` always separates layer-sections, and `{` is reported as `invalid-value` (no nesting allowed). They cannot decay into voxel-row strings because their characters (`{`, `}`, `,`) fall outside the voxel-cell character set `[.0-9a-zA-Z]`.

### 7.4 Palette declaration

```
palette <color>+
```

- **Exactly one** palette declaration per file (more is `duplicate`)
- May appear **anywhere** in the file — before, between, or after part declarations
- Each color in hex: `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`
- Color space: **sRGB**
- Maximum **62 colors** (palette indices `0..61`; more is `wrong-arity`)
- Voxel data references colors by single character:
  - `0`–`9` → palette indices 0–9
  - `a`–`z` → palette indices 10–35
  - `A`–`Z` → palette indices 36–61
- The character `.` is reserved for empty space (air) and is **not** part of the palette

Position-based indexing: reordering the palette requires rewriting voxel data. Tooling can automate this.

When voxel rows are parsed before the palette is known (because palette appears later in the file), palette-index validation (the assembly-time `invalid-value` check) is deferred until file assembly completes.

### 7.5 `part` declaration

```
part <identifier>
```

Starts a new part section. The parser detects new parts by this keyword; there is no explicit part-end marker. A part section ends at the next `part` keyword or at end of file. The `palette` declaration is file-level, not part-level — it may appear inside the textual span of a part section without ending it.

A `part` section must contain:

| Element | Cardinality | Notes |
|---|---|---|
| `size` | **exactly 1** | Missing → `missing`. Duplicate → `duplicate` |
| `pivot` | at most 1 | Duplicate → `duplicate` |
| `socket` | 0 or more | Duplicate names → `duplicate` |
| `voxels` | **exactly 1** | Missing → `missing`. Duplicate → `duplicate` |

**Order is free.** Any permutation of these elements within a part is valid. Writers should normalize to `size → pivot → socket* → voxels` for diff stability.

### 7.6 `size`

```
size <W> <H> <D>
```

- W = X-axis width, H = Y-axis height, D = Z-axis depth
- All values are positive integers in the range `[1, 1024]` per axis (zero or negative values, fractions, and values exceeding 1024 are `invalid-value`)
- Total voxel cells = W × H × D
- The 1024 cap is a sanity bound to keep validation and rendering tractable; future spec versions may relax it

### 7.7 `pivot`

```
pivot <x> <y> <z>
pivot <x> <y> <z> rot <rx> <ry> <rz>
```

- Optional. Default: position bottom-center, `[W/2, 0, D/2]`; rotation absent (identity)
- Position coordinates in **part-local space**, voxel units; may be fractional; may lie outside the grid bounds (W01 lint warning, not error)
- Optional rotation: 3 Euler angles in degrees, ZXY intrinsic order (§4), introduced by the reserved word `rot` (structurally valid here and in `socket` declarations per §7.3)
- **Semantic** (interpretation A — Rest pose rotation): when an animation is not active, the part is rendered with this rotation applied around its pivot position. When an animation is active, the animated rotation is composed with the pivot rotation. Using matrix-vector convention with column vectors, a part-local point `v_local` lands at `v_parent = part.position + pivot.pos + M_pivot · M_anim · (v_local − pivot.pos)`, where `M_pivot` and `M_anim` are the rotation matrices for `pivot.rot` and the animated keyframe rotation. Equivalently in quaternion form: `q_total = q_pivot · q_anim` (the animation rotation is applied first, in the rest-pose-local frame, then the pivot rotation brings it to the rest orientation)
- Two arities are valid at the library-level `parsePivot(args)` API: 3 args (position only) or 7 args (position + `rot` + rotation). 4–6 or 8+ args is `wrong-arity`; 7 args without the `rot` marker as the 4th token is `invalid-value`
- Under integrated `parseCvox()` parsing of the token stream, the parser consumes exactly 3 tokens (then 3 more iff the next token is `rot`). Tokens beyond that boundary are not stolen by the pivot declaration — they fall through to the main token loop and are diagnosed by §11.8 (typically `invalid-value` if numeric, `unknown` if a non-keyword identifier). A user writing `pivot 1 0 1 5` will therefore see `invalid-value` or `unknown`, not `wrong-arity`; the library-level `parsePivot()` is the entry point that enforces strict arity

### 7.8 `socket`

```
socket <identifier> <x> <y> <z>
socket <identifier> <x> <y> <z> rot <rx> <ry> <rz>
```

- Zero or more per part
- Position in part-local space, voxel units (fractional allowed)
- Optional rotation: Euler degrees, ZXY order, default `[0, 0, 0]`
- Socket name unique within a part

### 7.9 `voxels` block

```
voxels {
  <voxel-row>...     ← layer 0 section (exactly D rows)
  ,
  <voxel-row>...     ← layer 1 section (exactly D rows)
  ,
  ...                ← H layer-sections total, separated by H-1 commas
}
```

- **Exactly one** `voxels` block per part (missing → `missing`; duplicate → `duplicate`)
- The block contains H comma-separated **layer-sections**, one per Y-layer index in order
- The i-th section (0-based) becomes layer `i`. Layer indices are **positional** — there is no `layer N` keyword in v0.3
- Each layer-section contains exactly D voxel-row tokens (less or more → `wrong-arity`)
- Whitespace inside the block is purely cosmetic — rows can be inline, multi-line, or mixed; the entire block can be on one line (`voxels { 000 000 000 , .0. 000 .0. }`)
- **Leading and trailing `,` and consecutive `,,` create empty layer-sections.** `voxels { , 0 }` produces 2 sections (the first with 0 rows); `voxels { 0 , }` produces 2 sections (the second with 0 rows); `voxels { , }` produces 2 empty sections. These are syntactically well-formed but fail at assembly with `wrong-arity` unless `D = 0` (which the spec disallows: `size` dimensions are in `[1, 1024]` per §7.6, so empty sections always fail). The writer's canonical form omits leading/trailing/consecutive commas

**Lexical isolation** (§7.1 Layer 2): inside `voxels { … }` no reserved words are recognized. Any token (other than the universal `,` and `}`) is interpreted as a voxel-row string and subject only to:

- character set: `[.0-9a-zA-Z]` (other chars → `invalid-value`)
- length: exactly `W` (mismatch → `wrong-arity`)
- palette indices: must be `<` palette length (out of range → `invalid-value`)

A row spelling `rot` or `size` or `part` is **valid voxel data** when its 3 characters map to in-range palette indices (`r`=27, `o`=24, `t`=29; `s`=28, `i`=18, `z`=35; `p`=25, `a`=10). The `voxels` keyword reserves nothing; reserved words from other scopes are just letters here.

**Errors:**

| Condition | Code |
|---|---|
| `{` missing after `voxels` | `wrong-arity` (or `unknown`/`invalid-value` depending on the offending token) |
| `}` missing (EOF before close) | `missing` |
| Nested `{` inside a `voxels { … }` block (no nesting permitted) | `invalid-value` |
| Layer-section count ≠ H | `wrong-arity` |
| Row count in a section ≠ D | `wrong-arity` |
| Row width ≠ W | `wrong-arity` |
| Character outside `[.0-9a-zA-Z]` in a row | `invalid-value` |
| Row references palette index ≥ palette length | `invalid-value` |

The k-th row in layer `i` represents voxel cells at coordinates `(x, i, k)` for `x ∈ 0..W-1`.

### 7.10 Voxel row

- Inside a `voxels { … }` block, every non-punctuation token is a voxel-row candidate
- Characters drawn from `[.0-9a-zA-Z]`, no whitespace inside a single row token
- Length exactly equals W
- Each character is either `.` (air) or a palette index character (must be within the declared palette range)
- Multiple row tokens on a single line are separated by whitespace; either spaces or a newline serves as the separator

### 7.11 Comments

```
// this is a full-line comment
size 3 3 3  // this is an end-of-line comment
voxels {
  // comments work inside voxels blocks too — they are Layer 1 (universal)
  000
  000
}
```

- A `//` sequence anywhere on a line starts a comment; the comment extends to the end of that line
- **Universal scope** (§7.1 Layer 1): comments work in every scope, including inside `voxels { … }` blocks. They are stripped by the tokenizer before any scope-aware parsing
- No whitespace context is required around `//`; the `/` character does not appear in any valid Cuboidy token, so `//` cannot collide with data
- Note: color literals (`#FFFFFF`) use `#`, not `//`, and are unrelated to comments
- Writers (the canonical serializer) SHOULD preserve comments verbatim across read/write round-trips, attaching each comment to its enclosing structural element (file header, palette, part, metadata line, voxels block)

### 7.12 Examples

**Multi-line voxels block (compact for visual voxel art):**

```
palette #8B4513 #000000

part head
    size 3 3 3
    pivot 1 0 1
    socket hat 1 3 1
    socket mouth 1 1 3
    voxels {
        000
        000
        000
        ,
        000
        000
        101
        ,
        000
        000
        000
    }
```

**Inline voxels block (compact for small parts and AI generation):**

```
// crown — single part static accessory
palette #FFD700

part crown
    size 3 2 3
    pivot 1 0 1
    voxels {
        000 000 000      // layer 0 — solid base
        ,
        0.0 ... 0.0      // layer 1 — 4 corner pillars
    }
```

**Free-order example (palette at end, voxels before size):**

```
part body
    voxels {
        0
        ,
        0
    }
    size 1 2 1

palette #FF0000
```

**Reserved-word strings as voxel data** (palette must have at least 30 colors for `rot`, since `t` = palette index 29):

```
palette #000 #111 ... #01d    // 30 colors

part demo
    size 3 1 1
    voxels {
        rot                   // valid voxel row: palette[27]/[24]/[29]
    }
```

All four are valid Cuboidy v0.3 input.

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
| `cuboidy.json` | `version` | absent → `"0.3"` |
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

### 11.2 Diagnostic codes (structural)

v0.3 uses **five structural codes** to describe errors. The code names what *kind* of structural violation occurred; the message text names *what specifically* — which keyword, which field, which line. Implementations MUST use these exact code strings so that cross-language parity tests can compare outputs by code alone.

| Code | Meaning | Voxel-definition examples |
|---|---|---|
| `missing` | A required structural element is absent. | No `palette` declaration in the file; `palette` declared but no `part`; `size` missing in a part; `voxels` missing in a part; `voxels { … }` block unclosed (EOF before `}`); a reserved word used outside its structurally valid scope (e.g. `size` before any `part`, `rot` outside `pivot` / `socket`) |
| `duplicate` | A unique-constraint violation: an element that should appear at most once appears more than once. | Two `palette` declarations; duplicate `part` name; duplicate socket name within a part; duplicate `size` / `pivot` / `voxels` within a part |
| `unknown` | An unrecognized name appears where the spec defines a closed set. | A non-keyword identifier appears where no statement is expected; a top-level token has no valid grammatical role |
| `invalid-value` | A value is present but malformed. | Malformed color hex (`#GG`); voxel row contains a character outside `[.0-9a-zA-Z]`; voxel cell references a palette index that does not exist; size dimension out of range `[1..1024]`, fractional, or non-numeric; non-numeric `pivot` / `socket` coord; expected `rot` marker but got something else; identifier failing the §5 regex |
| `wrong-arity` | An incorrect number of items. | Voxel-row width does not match declared `W`; a layer-section row count differs from declared `D`; layer-section count differs from declared `H`; palette has 0 colors or more than 62; wrong number of arguments to a keyword (`size` not 3, `pivot` not 3-or-7, `socket` not 4-or-8, `part` not 1) |

Note: v0.1 used per-keyword codes (E01–E19). v0.2 restructured them into the five structural categories above. v0.3 removed the `layer` keyword and the active-layer concept (replaced by `voxels { … }` blocks), simplifying the precedence rules; the five codes are unchanged. The keyword/context survives in the message string and in the fixture filenames (`fixtures/cvox/<code>/<descriptor>.cvox`).

### 11.3 `voxels.cvox` warnings

| ID | Rule |
|---|---|
| W01 | Pivot outside voxel grid bounds |
| W02 | Socket outside voxel grid bounds |
| W03 | Palette index declared but never used |
| W04 | Layer-section entirely empty (all `.`) |
| W05 | Part has no solid voxels (all `.`) |

### 11.4 `voxels.cvox` hints

| ID | Rule |
|---|---|
| H01 | Part name violates `lower_snake_case` or `lower-kebab-case` convention |
| H02 | Pivot uses fractional value in an otherwise integer-aligned grid |

### 11.5 `cuboidy.json` errors

Manifest errors use the same five structural codes (§11.2). The TS reference implementation maps observed validation failures as follows; other implementations should converge on the same mapping for parity:

| Code | Manifest examples |
|---|---|
| `missing` | Top-level `name` is absent; top-level `parts` is absent or empty |
| `duplicate` | Duplicate part name; duplicate animation name (planned) |
| `unknown` | A field other than `name` / `version` / `parts` / `animations` is present at the top level; a field other than `name` / `parent` / `position` is present inside a part |
| `invalid-value` | Wrong type for a field (e.g. `name` is a number); identifier failing the §5 regex; `parent` references a non-existent part (planned); parent chain contains a cycle (planned); animation reference path malformed (planned); animation `duration` less than the largest time key (planned); time keys not strictly increasing or not starting at `"0.0"` (planned) |
| `wrong-arity` | (no current cases for the manifest; reserved for future use) |

Items marked "planned" are not yet implemented in the TS reference; the catch-all `invalid-value` may surface generic Zod messages for those cases until then.

### 11.6 Cross-file rules

| Code | Severity | Rule |
|---|---|---|
| `missing` | error | `cuboidy.json` references a part name not defined in `voxels.cvox` |
| `unknown` | warning | `voxels.cvox` defines a part not listed in `cuboidy.json` `parts` |
| `unknown` | warning | Animation targets a part not present in `cuboidy.json` `parts` (cross-rig sharing; planned) |
| `unknown` | runtime error | Attempt to attach to a socket name not declared on the host part (planned) |

### 11.7 Diagnostic format

Implementations should emit diagnostics in the form:

```
<file>:<line>[:<col>]: <severity>: <message> [<rule-id>]
```

Example:

```
voxels.cvox:5:1: error: row width 4, expected 3 (per `size 3 2 4`) [wrong-arity]
voxels.cvox:12: warning: pivot [3, 0, 5] outside grid bounds [0..3, 0..3, 0..4] [W01]
cuboidy.json:18: error: animation 'walk' targets part 'wing' not in model [missing]
```

This format is gcc / clang compatible for IDE integration.

### 11.8 Error precedence

When a single input could match more than one error (common under free-order rules), implementations MUST report **the first error encountered during a single forward pass over the token stream**, with errors raised during assembly (after all tokens are consumed) coming after all stream-pass errors.

Concrete precedence:

1. Per-line `//` comment stripping (no errors possible).
2. Tokenization (no errors possible; any non-whitespace sequence becomes a token; `{` `}` `,` are 1-char tokens).
3. Token-stream forward pass — raised at the point the offending token is consumed:
   - **`duplicate`** — duplicate `palette` declaration; duplicate `part` name; duplicate socket within a part; duplicate `size` / `pivot` / `voxels` within a part
   - **`wrong-arity`** — too-few args for any keyword consumed by the integrated parser (`palette` empty, `size` < 3, `pivot` < 3, `socket` < 4, `part` < 1; per §7.2's argument-collection rule, this happens when a reserved token arrives before enough args are collected); palette overflow (`> 62` colors); `voxels` not followed by `{`; nested `{` inside `voxels { … }`
   - **`invalid-value`** — bad color hex; non-numeric value where number expected; size dimension out of range; identifier failing the §5 regex; missing or wrong `rot` marker
   - **`missing`** — a reserved token consumed outside its structurally valid scope (per §7.3.3): a part-scoped keyword (`size` / `pivot` / `socket` / `voxels`) before any `part` declaration; `rot` outside `pivot` / `socket`; `{` / `}` / `,` at top level or in any position where its enclosing scope is absent; `voxels { … }` block reaches EOF without `}`
   - **`unknown`** — non-reserved token with no valid grammatical role at this point. This includes extras left over after a keyword consumed its required args (e.g. the `9` in `size 1 1 1 9`, the `b` in `part a b`, the `5` in `pivot 1 0 1 5` — see per-keyword notes in §7.5–§7.9), and stray identifiers / numbers at top level
4. End-of-stream assembly — raised after all tokens are consumed (validation deferred because palette may be declared anywhere in the file, so voxel-row content cannot be validated at consumption time):
   - **`missing`** — palette absent; palette declared but no parts; `size` missing in a part; `voxels` missing in a part
   - **`invalid-value`** — voxel cell character outside `[.0-9a-zA-Z]`; voxel cell references a palette index outside the declared palette
   - **`wrong-arity`** — layer-section count differs from `H`; a layer-section row count differs from `D`; voxel row width does not match `W`

**Library-entry-point arity vs integrated arity** (informational): the library-level entry points `parsePart(args)`, `parseSize(args)`, `parsePivot(args)`, `parseSocket(args)`, `parsePalette(args)` enforce strict `wrong-arity` for both too-few and too-many arguments — they see the args slice the caller hands them. The integrated parser (`parseCvox`) however *cannot* return `wrong-arity` for too-many args of a keyword, because per §7.2 it consumes only the required count and lets extras fall through. Implementations MUST be consistent within each entry point.

A conformant implementation that reports a different code than this precedence implies is non-conforming for cross-implementation parity testing, but its output is still useful to the user.

---

## 12. Reference examples

The reference repository includes:

- `wolf/` — three-part rigged model (body / head / tail) with idle animation and sockets (`hat`, `mouth`)
- `crown/` — single-part static accessory designed to attach to `wolf` via the `head:hat` socket

Both pass all v0.3 lint rules at error level.

---

## 13. Future extensions (out of scope for v0.3)

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
