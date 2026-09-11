# Cuboidy specification changelog

Revision history for [SPEC.md](SPEC.md). Newest first. Section numbers refer to
the spec as it stands now.

## v0.9 (draft — current)

### Flipbook lint — W09, W10, W11, H04

No change to the format. A **flipbook** is how a volume whose voxel count
changes gets animated — fire, smoke, a plant putting out a leaf, a damage
state — and it needs nothing new, because it is already expressible: parts
named `<prefix>_f0`…`<prefix>_f<n−1>`, each the whole shape at one instant,
with a clip keying `visible` (§6.5, which steps per §6.7) so exactly one of
them is drawn at a time. No transform turns one shape into a different one, so
this is the only construction available, and it was in use in a consumer
package before any of it was written down.

What the format could not do is say when it was **wrong**. Two frames visible
at one instant renders as one thicker flame; none visible is a hole for a fifth
of a second. Both parse, both resolve, both pass every other check in the
toolchain, and neither is visible in a still — a rest-pose render draws all
eight frames stacked, so it shows nothing either way. Four rules close that
(§11.6):

- **W09** — a clip keys `visible` on some members of a set and not others. The
  unkeyed one holds the §6.5 default `true` and covers the rest. W10 is
  suppressed for that clip: the co-visibility is at every instant, and
  reporting it once per keyframe buries the sentence that names the cause.
- **W10** — an instant where the count of visible members is not exactly one.
  `visible` steps, so visibility is constant between consecutive key times and
  sampling each of the set's key times is exhaustive rather than a probe.
- **W11** — indices that are not `0..n−1`: a gap, or two names spelling one
  index (`_f0` and `_f00`).
- **H04** — outside the 4–8 frame band, or keyed at uneven intervals. A hint,
  not a warning: this is about how the loop reads, and a deliberate hold is
  allowed to sit here. §11.1 makes that split the operative decision, since a
  warning fails `--strict` and a hint does not.

All four are scoped by a clip rather than by the naming. `_f<n>` is a
convention, not a reserved word, so the rules apply to a prefix group only once
some clip keys `visible` on one of its members — two fixed panels called
`panel_f1` / `panel_f2` are never reported.

`cuboidy-query --colors` gained the same frame awareness: with `--anim` and
`--time` it counts only the parts visible at that instant. An assembled
flipbook holds every frame at once, so a rest-pose census of a campfire counts
its flame eight times over — 69% of the model loud orange against the 28% a
player sees. That is not a rough version of the same number.

### Rest scale on a part

A manifest part may now carry `scale`, per-axis multipliers on its own voxels
around its pivot (§6.2):

```json
{ "name": "hair", "parent": "head", "scale": [1.1, 1.1, 1.1] }
```

Purely additive, and deliberately **not a new operator**. `scale` already
existed as a keyframe attribute (§6.5); this is the rest term of the same
thing, exactly as the part's `rotation` is the rest term of the keyframe
`rot`. The two multiply — `S_total = scale ⊙ anim.scale` — and because both
act per axis around the same pivot and neither reaches the part's children,
they commute and the order they compose in is unobservable.

That inheritance rule is the part worth reading twice. **Scale stops at the
part**, so scaling a rig by scaling every part does not work: each part grows
in place while every `position` stays where it was, and the parts drift apart.
Resizing a model means changing its `size` and `position` values, or scaling
the assembled model in the host engine. What the field is for is a part that
should sit slightly proud of its neighbour — a hair shell a tenth of a voxel
outside the skull it covers — which is otherwise a whole voxel of clearance or
nothing.

Two consequences fall out of "scale acts on the pivot-relative offset":
the pivot is the one point that does not move, so a scaled part stays attached
where its `position` says and its children neither grow nor shift; and a
socket rides the scale like every voxel around it (§7.8), while the guest
attached to it does not.

Every factor MUST be `> 0`. Zero collapses the part, which is `visible: false`
written in a way no reader expects, and a negative factor mirrors it, which
reverses face winding — a separate feature rather than a number that scale
happens to accept.

**The occupancy grid ignores it.** The assembled grid a query or an ASCII
dump reads is a map of which cell a voxel is, and scale does not move voxels
between cells — it changes how large they are drawn. Scale reaches the
geometric layer (meshing, snapshots, socket frames, world bounds) and stops
before the grid, which is the same line already drawn for rotation.

### Palette materials

A palette entry may now be an object instead of a bare color string, carrying
`metallic`, `roughness` and `emissive` alongside it (§7.4):

```json
"palette": ["#B8BEC6", { "color": "#C0C4CC", "metallic": 1, "roughness": 0.25 }]
```

The names are glTF 2.0's metal-rough workflow, so Unity, Godot and three.js
take them without translation, and `emissive` scales the entry's own color
rather than carrying a second one.

Purely additive. Both forms are the same entry and occupy one index; the
defaults (`0`, `1`, `0`) are a plain matte surface, which is exactly what a
palette rendered as before the field existed; and canonical output writes the
string form whenever the material is the default, so a palette of plain colors
round-trips byte-identically.

**Material MUST NOT change geometry.** Two models differing only in material
have the same surfaces, corners and triangles — that is the normative part,
and it is what a second implementation can be held to. Grouping those
triangles by material, so one part with three finishes is three draws off one
buffer, is explicitly allowed and is what `buildMesh` does.

How a renderer *shades* those numbers is not normative: a flat-shaded contact
sheet and a PBR viewport are both conforming. Alpha remains the deliberate
exception, since it hides faces.

### What a mesh must agree on

§7.4 now says which part of a mesh is shared between implementations, because
the spec and the reference implementation had been claiming opposite things:
the spec said index order was free, while `mesh.ts` said its own emission
order WAS the parity reference.

The set of faces is normative; the order is not. Pinning the order would make
greedy meshing — or any face merging at all — a breaking change to the format
rather than a change to a renderer, which is the wrong place to put that cost
for a voxel format.

Two consequences are normative in turn. **Comparing implementations is a set
comparison**, and `cuboidy-query --mesh` prints that canonical form (sorted
faces plus a digest). And **a material's index in a mesh's material list is
derived from its value** — ordered by `translucent`, then `metallic`,
`roughness`, `emissive` — rather than from first appearance, which would have
tied it to the voxel walk that §7.4 deliberately leaves free.

Also corrected: §1 still said the format does not specify materials; §6.10's
palette file still required `colors` to be strings, though a shared palette
has to be able to say everything an inline one can; and §10's defaults table
omitted the material fields entirely. That last one was a trap — §7.4 points
at glTF for the field names, and glTF's own `metallicFactor` defaults to 1.0,
so a reader who trusted the reference and found no row would render every
matte model as metal.

### Translucent palette colors

A palette color's alpha channel now means opacity. `#RGBA` and `#RRGGBBAA`
were already legal and already parsed — what they meant was never written
down, and every renderer discarded the value. §7.4 defines it, and the two
rules that make it drawable:

- **A face is dropped only when its neighbour hides it** — the neighbour is
  opaque, or it is the very same palette index. Being merely solid is not
  enough; that rule would put a hole in the wall behind a pane of glass.
- **A run of one translucent color is one surface, whatever its thickness.**
  Three voxels of water read exactly as one does. Depth is expressed by
  choosing a denser color, not by stacking, and an implementation MUST NOT
  blend per layer.

Renderers draw the opaque faces first with depth writes, then the translucent
ones back to front with the depth test but no write. `buildMesh` orders its
indices opaque-first and reports the split so the two passes are two ranges
of one buffer.

Two clauses of that got spelled out after both were got wrong in this
repository. **Back to front is per face, not per object** — sorting whole
meshes and letting the faces inside one draw in emission order fails from
about half of all viewpoints, and the symptom (wedges of the far color
surfacing through the near one, one per voxel, sliding as you orbit) reads
convincingly as stray internal geometry. And **faces are single-sided**:
corners are wound counter-clockwise seen from outside the voxel, and back
faces MUST be culled. That is what makes it correct for both voxels to keep
their face where two translucent colors meet — the shared rectangle carries
two opposed quads, and culling keeps the one whose color you are looking
through.

A fully transparent color (`00`) renders nothing, but its voxels are still
voxels: they occupy their cells, count toward the bounding box, and answer a
coordinate query. Use `.` for air.

### Rules tightened ahead of the second implementation

A pre-port audit of the reference implementation found several places where
the spec and the code disagreed, or where the spec was silent about something
two implementations would have to agree on. These are the resulting normative
changes. One of them is **breaking**.

**§6.6 — a time key requires its decimal point.** `"1"` is no longer a time
key; `"1.0"` is. Formally `^[0-9]+\.[0-9]+$`, which also excludes `"0x10"`,
`"1e3"`, `"5."` and `"+1"`.

*Breaking.* A clip keyed `{"0": …, "1": …}` loaded before and does not now.
Every shipped model already wrote the decimal form, but real documents used
the other one. The reason is that a JSON object key spelling a small
non-negative integer is not an ordinary string key in every language's object
model — JavaScript hoists it, so a track written in order reads back out of
order and the §6.6 ordering rules reject it, while a reader over an
order-preserving parser accepts the same file. Requiring the point keeps
every legal key an ordinary string key, so implementations agree on which
documents are valid instead of on which parser read them. A reader MAY accept
the integer form and normalize it, but MUST NOT emit it.

**§6.7 — easing endpoints are exact, and a near-keyframe time snaps.**
Implementations MUST return `0` and `1` from a preset at `u = 0` and `u = 1`
rather than whatever the formula evaluates to; five of the twenty land a
rounding step away and two of those return `-0`. Interior values follow the
formulas as written, but are compared across implementations to a tolerance,
not bit-for-bit — eleven presets go through `sin`/`cos`/`pow`, which no
runtime is required to round correctly.

Separately, a sample time within a tolerance of a keyframe IS that
keyframe's time, for every attribute at once. Wrapping is
the exact IEEE remainder of a dividend that is not the number the author
wrote, so a clock a whole number of loops past a key lands a few ULPs below
it — enough for a step attribute to read "not yet" while the interpolating
ones sit at `u ≈ 1`.

**§6.7 — the interpolation form is pinned, the snap tolerance is bounded, and
a non-finite time is defined.** Three corrections to the paragraphs above,
made when a second audit measured what they actually guaranteed.

Interpolation is `a·(1 − u′) + b·u′`, not `a + (b − a)·u′`. The spec already
promised that a keyed value is hit *exactly* at its keyframe and clamped the
easing endpoints to make it true; that turns out to be half the requirement,
because the second form is not exact at `u′ = 1`. Measured over the models in
this repository, 36 of 3411 keyed components did not survive a round trip
through the sampler — `fox/trot` keys `-0.02` and read back
`-0.01999999999999999`. This is the only arithmetic form the spec names.

The snap tolerance is now `min(max(|time|, duration) × 1e-12, g / 1000)` for
`g` the smallest gap between adjacent keyframes, with a tie going to the
earlier key. Scaling with the clock is right — the wrap error does — but
unbounded it overtakes what it is measuring: against keys 1 ms apart, a clock
at `1e9` gives a tolerance a whole key spacing wide, so every sample snaps and
the part freezes. It also applied to `loop: false`, where the clamp is exact
and there is no error to tolerate, and at `1e308` it snapped `duration` back
to `"0.0"` — returning the first keyframe where the last must hold.

A thousandth of a gap, not half of one. Half is the largest tolerance that
cannot reach a non-nearest key, and a first version of this rule used it —
but half-gap intervals centred on the keys **tile the timeline**, so at that
bound every sample is within tolerance of something and the freeze is exactly
as complete. Measured on the very track this paragraph describes, `g / 2` left
2 distinct values across the clip at a clock of `1e9`, precisely as the
unbounded form did.

A non-finite sample time samples as `0`, except that `±Infinity` still clamps
to an end for `loop: false`. Previously unstated, and the consequence was not
a different answer but a different failure per host: reading past the end of
the keyframe array gives a pose of `NaN`s in one language and an exception in
another, and which one you got depended on how many keyframes the track had.

**§6.4 — a clip's `parts` keys are part names, so §5 applies.** `""`,
`"1bad"`, `"a b"` and the reserved `"size"` were all accepted as track keys,
while the `animations` and `sockets` map keys beside them were both checked.
§6.8 still permits a key that IS a legal name but matches no part in this
model — that is the cross-rig sharing rule and it is unchanged.

*Breaking, narrowly.* A clip keyed by something that could never be a part
name loaded before and does not now.

**§6.13 — `part` is a reference-form field and is `unknown` inline.** The
spec already said the inline object is exactly a §7.5 part minus `name` plus
`palette`, and said out loud that a second `name` is not permitted; `part`
was the same case from the other side and went unlisted. Written inline it
parsed and was then discarded in silence, which is the shape of the actual
authoring mistake: naming the part, forgetting the file.

**§7.4 — an index no palette defines renders as opaque magenta.** Previously
unstated, and left to each renderer. Cross-file validation still reports it,
but reporting is authoring-time and a runtime that only draws needs a defined
answer rather than a crash or an out-of-bounds read.

**§7.8 — a host part's animated `scale` moves its sockets.** Previously
unstated, and the reference ignored it, so a socket at the tip of an arm
stretched to 3× stayed a third of the way along. A socket is a point in the
part's geometry and goes through the same mapping the voxels do. The guest is
NOT resized: the frame carries position and orientation only.

**§11.5 / §11.6 — an ambiguous part name is a resolution failure.** A part
name defined in two files of the `geometry` list leaves the by-`name` lookup
with no answer, so an implementation that resolves references but does not
lint MUST still refuse the model rather than binding to whichever file it
read first.

### Per-part geometry, and a single-file model

A manifest part gains an optional **`geometry`** object (§6.13) saying where its
shape comes from — a file, or written out on the spot:

```json
{ "name": "head",      "parent": "neck", "geometry": { "path": "voxels.json" } }
{ "name": "cap",       "parent": "head", "geometry": { "path": "gear/caps.json", "part": "beret" } }
{ "name": "foreleg-l", "parent": "body", "geometry": { "size": [3, 10, 4], "voxels": [ … ] } }
```

The inline object is exactly a §7.5 part object with `name` removed (the
enclosing part already has one, and two copies can disagree), plus an optional
`palette`. `path` present means the reference form; `part` defaults to the
enclosing part's `name`, so pointing at a file is usually one field.

Two things follow. **A model can now be one text file** — inline every part and
nothing is left to reference. `<name>.cuboidy` (§13) already packed a model
into one file, but as a ZIP; an all-inline `cuboidy.json` stays diffable,
pasteable and editable in a text editor, which is what §1 asks for.

And **the rig↔shape join becomes explicit**. It used to rest entirely on part
names matching across files, which is why §11.6 carried two rules for the ways
that could silently fail. With a reference, "defined in a geometry file but in
no manifest part" is decidable per part and names the file the author actually
pointed at.

Absent `geometry` keeps the by-`name` lookup, so every existing model is
unchanged and the three forms mix freely within one manifest.

The reference is an object rather than a `file.json#part` string because §8's
grammar would read `voxels.json/head` as a file inside a directory, and a
fragment would be a second grammar layered on the first. Two named fields need
neither.

### The manifest's `palette` returns, scoped

Inline geometry has no file to take colors from, so the manifest gains a
top-level **`palette`** (§6.1) that inline parts use when they declare none of
their own.

This is the field v0.7 had and v0.9 removed, under the same name — but not the
same thing, and the difference is the whole point. v0.7's palette **overrode**
geometry files, so a self-contained file's indices meant different things
depending on who loaded it; that precedence is what made it wrong, and what
took hint H03 with it. This one **never reaches into a file**. A part in the
reference form always uses its file's palette (§7.4). The manifest's palette
covers only geometry the manifest itself contains, where there is no other
declaration to shadow.

New lint **W08** flags a manifest `palette` that no inline part uses — which is
exactly what a v0.7 manifest looks like, so the case that would otherwise
change meaning in silence is reported instead.

### `cuboidy.json` is required

Not a change to this document — §3 has always made it the package's anchor, and
nothing here ever blessed a manifest-less model. The reference tools were more
permissive than the spec: `cuboidy-lint` accepted a directory holding only
`voxels.json`, and the editor would open a lone geometry file as a second-class
document with no rig view, no animation view and a "Create manifest" promotion
step. §3 now says outright that the absence is `missing`, and the tools have
been brought into line. The case that permissiveness served — one file, no
ceremony — is what inline geometry now covers properly.

### Published sockets

The manifest gains an optional top-level **`sockets`** object (§6.12) mapping a
model-wide published name to the part and socket it aliases:

```json
"sockets": { "weapon": { "part": "hand-r", "socket": "grip" } }
```

Sockets themselves are unchanged — they are still declared per part in the
geometry file (§7.8). What changes is that declaring one no longer exposes it.
`sockets` was the one capability a consumer could not discover from the
manifest: `geometry`, `animations` and the rig are all declared there, but to
learn that `hand-r` had a `grip` you had to open the geometry files and read
past the model's public surface. Publication also gives an attachment point a
name that survives renaming the part or the socket underneath it, and a name
that is unique **model-wide** — §5 only makes a socket unique within its part,
so two parts could each declare `tip`.

Two rules follow. A published `part` that names no part in `parts` is a
manifest `invalid-value` (§11.5, alongside a bad `parent`); a published
`socket` the host part does not declare is a cross-file `missing` (§11.6).
Together they retire the "planned" line §11.6 carried for attaching to a
socket that does not exist — what remains there is now a well-defined
consumer-side error: attaching by a name the model does not publish.

Two corrections come with it. §7.8 said an attached asset's **root pivot**
lands on the socket; §6.2 permits multiple root parts, so that point is not
always unique. The guest's **model origin** does, and it is what authors
already do in practice. And §14's attachment entry described publication as
part of the missing feature; it now scopes the gap to composition proper —
recording *that* an attachment happens is a scene, not an asset, and is
deliberately left to a layer above this format.

**Migration:** none. `sockets` is optional and absent means the model publishes
nothing, which is what every existing model does today.

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
