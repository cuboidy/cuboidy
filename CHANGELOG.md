# Cuboidy specification changelog

Revision history for [SPEC.md](SPEC.md). Newest first. Section numbers refer to
the spec as it stands now.

## v0.9 (draft — current)

### Geometry moves to JSON

The geometry file moves from the bespoke `.cvox` text format to **JSON** —
`voxels.json` (§7). The data model is unchanged: parts, sizes, pivots, sockets
and the positional H×D×W voxel grid all keep their meaning, and voxel rows
remain strings in the same `[.0-9a-zA-Z]` alphabet (`"0220"`), so a grid still
reads as a grid. What goes away is the container: the lexical structure, the
grammar, the reserved-token machinery and comments. §7.2, §7.3 and §7.11 are
retired, and the reserved-keyword list they defined moves to §5, where it still
constrains identifiers. Surviving subsections keep their numbers so
cross-references stay valid.

Rationale: the text format existed to be token-cheap and AI-authorable, and
neither claim survived measurement — reasoning dominates generation cost, so
the file-size difference moves the total by single digits, while a hand-written
parser blocks every third-party implementation. The measurements are summarized
in [README.md](README.md).

### Palette ownership moves to the geometry file

The manifest's top-level `palette` binding (added in v0.7) is **removed**. A
geometry file's `palette` field (§7.4) now takes either form: an array of hex
colors, or a §8 reference path to a shared palette file (§6.10). References
therefore run `cuboidy.json` → geometry → palette, a tree, replacing the v0.7
arrangement where the manifest reached past the geometry file and overrode it.

Precedence goes away with the override: a file spells its colors out or points
at a file that does, never both, so there is nothing to shadow and lint hint
**H03** is retired. Index-range validation is unchanged in principle — parse
time for an inline palette, cross-file for a referenced one (§11.6) — and a
geometry file stays independently well-formed either way.

**Migration:** move `"palette": "x.json"` from `cuboidy.json` into each geometry
file that uses those colors. Models with inline palettes are unaffected.

### Packed format specified

`<name>.cuboidy` was listed as a future extension while the editor already
read and wrote it, so the implementation had quietly made every decision the
specification should have. §13 now settles them: `cuboidy.json` at the archive
root with readers also accepting one wrapping directory, §8's path rules
applied to entry names and **rejected rather than sanitised**, duplicate
normalised paths as `duplicate`, store/deflate only, and a required bound on
expansion.

The consequential one is §13.3: an entry a reader does not understand must be
**preserved byte-for-byte** when the archive is written back. The editor had
been dropping everything that was not `.json` / `.md` / `.txt`, so opening a
package containing a thumbnail and exporting it silently deleted the
thumbnail. The reference implementation now carries such entries through.

### Per-part rest rotation

The manifest part object gains an optional **`rotation`** field (§6.2): the
part's rest rotation in parent space, 3 Euler angles in degrees, ZXY intrinsic
order (§4), applied around the part's pivot. It composes **outside** the
geometry file's `pivot.rot` and inside the parent's transform, so the full §7.7
rotation becomes `q_total = q_rotation · q_pivot · q_anim`. Keyframe `rot`
values remain relative to the (now two-term) rest rotation, and children ride a
parent's rest rotation like any other parent transform. Absent → identity, so
existing models are unchanged.

Tooling note: `cuboidy-snap` renders rest rotations (both `rotation` and
`pivot.rot`) as true oriented cubes. The integer-lattice projections
(`cuboidy-view` / `cuboidy-query`) place a rotated part's **pivot** exactly
where the rig puts it but keep the part's own voxels axis-aligned, and emit a
warning saying so.

## v0.8

**Per-attribute keyframe easing** (§6.5, §6.7). A keyframe gains an optional
`ease` object mapping an attribute (`rot` / `pos` / `scale`) to the
interpolation curve of that attribute's **outgoing** segment (this keyframe →
the next). Curves are 20 named presets — `linear` (default), `step`, and `in` /
`out` / `in-out` variants of `sine` / `quad` / `cubic` / `back` / `elastic` /
`bounce` — applied as a remap of normalized segment progress before linear
interpolation (`visible` always steps and cannot be eased).

`ease` is deliberately **exempt from §6.5 carryover**: a curve applies only
where it is written, and only to its own attribute — it never propagates to
later keyframes or leaks onto other attributes. Custom cubic-bezier curves
remain reserved for a future revision.

**Part reuse removed.** The `clone` / `mirror` reuse-clause added in v0.6 is
gone: every part is now concrete voxel data, and symmetric or repeated geometry
is authored by copy/mirror tooling that emits plain voxels (`cuboidy-part`).
`clone` and `mirror` stopped being reserved keywords, and the `Part.from` AST
field was removed.

## v0.7

The package generalizes from the fixed two-file layout to **manifest-anchored
references**. `cuboidy.json` remains the package's only fixed filename (the load
anchor); every other file is named freely and found by reference.

1. **Multiple geometry files.** The manifest gains an optional top-level
   `geometry` array (§6.9) listing the package's geometry files by reference
   path (§8); absent → the previous fixed single-file default, so existing
   models are unchanged. Part names remain unique across the whole model (§5) —
   a name defined in two geometry files is a cross-file `duplicate` error.
2. **Shareable palettes.** A geometry file's palette declaration is relaxed
   from "exactly one" to "at most one", and a new external palette file
   (`{ "colors": [...] }`, §6.10) can be bound model-wide via the manifest's
   optional top-level `palette` reference, which takes precedence over inline
   palettes. A palette-less file's index-range validation moves from parse time
   to cross-file validation.
   *(The manifest-level binding, its precedence rule and the companion hint H03
   were all removed in v0.9 — see above.)*
3. **New lint W07**: a geometry file present in the package but not referenced
   by `geometry`.

External animation files were already specified in v0.6 (§6.3, §8) and are
unchanged.

## v0.6

Added **part reuse** — a `clone` / `mirror` reuse-clause in the part header.
*(Removed in v0.8; see above. The companion lint **W06**, §11.6, which flags an
`l`/`r` pair whose assembled geometry is not mirror-symmetric, remains.)*

## v0.1 – v0.5

These revisions developed the `.cvox` text container that v0.9 removed:
comment-preservation policy, quoted-versus-bare identifier tokens, the
`voxels { … }` block that replaced the `layer N` keyword, whitespace and token
separation rules, and the move from per-keyword diagnostic codes (E01–E19) to
the five structural categories still in use (§11.2).

Everything specific to that container is obsolete — there is no `.cvox` file to
migrate — so the entries are not reproduced here. They are in git history.

The one part that outlived the container is the **reserved-keyword rule** for
identifiers, which v0.4/v0.5 settled and §5 still carries.
