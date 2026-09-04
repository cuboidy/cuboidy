# Authoring Cuboidy models

The companion to `SPEC.md` for anyone — human or language model — authoring from
scratch. **The spec says what is legal; this says what tends to work**, and what
to do when a check comes back unhappy.

The golden rule: **write the geometry by hand and let the CLIs give you
feedback** — do not generate it from a script (that defeats the point of a
readable format and hides what hand-authoring can do). "By hand" and "by a model"
are the same side of that rule: what it rules out is *generating* geometry
mechanically, not who writes it.

Most of this document is craft — the traps, the arithmetic, the things that pass
every check and still look wrong. The sections that are procedure rather than
craft are marked as such, and a model working through a batch can read those
first: **the order of work**, **verification**, **when a check fails**, **when to
stop**, and **what a brief must supply**.

Nothing here decides what a model should look like. Palette, scale and subject
belong to whoever commissions the work — see the last section.

## Where to put the geometry

Every model is anchored by `cuboidy.json` (SPEC §3) — that file is required,
and a lone `voxels.json` is not a model. Each part then says where its shape
lives (§6.13):

```json
{ "name": "head", "parent": "neck", "geometry": { "path": "body.json" } }
{ "name": "gem",  "parent": "head", "geometry": { "size": [1,1,1], "voxels": [["0"]] } }
```

Rules of thumb:

- **Small model, or a quick prototype** — write every part inline and keep the whole
  thing in one file. Nothing to reference, nothing to keep in sync, and you can
  paste it somewhere whole.
- **Anything with a real rig** — put the parts in geometry files grouped the way
  you think about the body (`body.json` / `arms.json` / `legs.json`, as `knight`
  does) and point at them. Long voxel arrays crowd out the rig otherwise: the
  hierarchy is the thing you re-read constantly while animating, and it should
  fit on a screen.
- **Mixing is fine and often right** — reference the big parts, inline the
  one-off 1×1×1 gem that would be silly as its own file.

Omitting `geometry` entirely still works: the part is looked up by name in the
files listed under the top-level `geometry`. That is how every model here was
written before §6.13, and it is the most compact form for a model where the
manifest and one geometry file already line up.

## The loop (procedure)

```
manifest (rig only)  →  lint  →  geometry, part by part  →  lint  →  snap  →  LOOK  →  fix
                                                    then  →  animate  →  gif   →  LOOK  →  fix
```

**Write the manifest first, with no geometry at all.** A rig of named parts with
positions and parents is cheap to write, cheap to fix, and it is where the
proportions live. Discovering the proportions are wrong after writing voxels
means rewriting voxels.

Lint at that stage prints one `cannot read <the geometry file you declared>`
and nothing else. **That error is expected and is the only one you ignore** —
the rig itself is still checked with no geometry present: a duplicate part name
and a `parent` naming nothing are both reported. If the file it names is one
you never declared (`voxels.json`), the MANIFEST failed to parse and lint fell
back to the default name; fix the manifest error printed above it.

Then geometry, one part at a time, largest first — torso before head, head before
ear. A part written early is the size reference for whatever hangs off it.

**Do not write all the voxels and then lint.** Lint after each part, while the
mistake is still one part wide. Row-width and layer-count errors are the ones you
will actually make, and a wrong row reads exactly like a right one whether there
is one of them or twenty.

Work in passes, never all at once:

1. **Blockout** — rough boxes, flat colors. Lock in PROPORTIONS and the RIG
   (part hierarchy + manifest positions). Snap, adjust sizes/positions only.
2. **Shape** — round/chamfer/taper the boxes. Snap.
3. **Detail** — face features, hair parts, dress, subtle shading. Snap.
4. **Animate** — last, once the rest pose looks right.

Each pass: change a little, snap, look, fix. Resist detailing before the
blockout proportions read well — detail on wrong proportions is wasted.

## Coordinate model (get this right first)

A part is a `W×H×D` grid. `"size": [W, H, D]`, and `voxels` nests to match:

```
"voxels": [
  ["front", "...", "back"],   <- layer y=0, one string per Z row
  ["front", "...", "back"]    <- layer y=1
]
```

- **H layers** — entry *i* is the Y-layer, bottom→top.
- Each layer has **D rows** — row *k* is Z.
- Each row has **W chars** — char *j* is X (`.` = air, else a palette index char).

**`size` is a bounding box, not a canvas.** A Y-layer containing no solid cell
lints as **W04**, and `--strict` makes that fatal. So the natural blockout
instinct — give every part of an assembly the same grid and taper it by writing
air — is not available to you. Shrink `H` instead of padding it, and expect to
resize parts as their shape settles rather than carving them out of a shared
box. (A part with no solid cell anywhere is **W05**.)

So a cell `(x,y,z)` is `voxels[y][z][x]`. Consequences:

- **Row 0 of each layer = z=0 = FRONT** (the model faces −Z). Last row = back.
- **First char = x=0**; +X is the model's right.
- For a front-facing face, **make each row a palindrome** → automatic L/R symmetry.

## Pivots & the manifest

- **A voxel cell fills the unit interval after its index.** Cell `x` occupies
  `[x, x+1)`, so its centre is `x+0.5`. Almost every symmetry surprise in this
  format comes from forgetting that. In particular, mirroring across a pivot
  plane sends the cell at `x` to the cell at **`−1−x`**, not to `−x`.
- **Choose each axis's parity from what the silhouette has to do**, then be
  consistent about it. This only matters for a part whose pivot is meant to be
  its **centre**; if the pivot belongs on an edge or an axis line — a hinge, a
  rotor arm, a hanging rope — write that pivot and parity is irrelevant.
  Putting an integer pivot on an axis you never rotate or mirror about is also
  a free way to stay on the integer lattice. For a genuinely centred part, the
  default pivot is `[W/2, 0, D/2]` and the parity decides what it costs:

  ```
  W=4, pivot 2   (default)   cells at -2..1     centred, integer lattice
  W=5, pivot 2.5 (default)   cells at -2.5..1.5 centred, half-voxel lattice
  W=5, pivot 2   (integer)   cells at -2..2     OFF CENTRE by half a cell
  ```

  **Even** keeps you on the integer lattice, which keeps `cuboidy-view` and
  `cuboidy-query` exact. Prefer it for slabs — torsos, walls, limbs.

  **Odd** is the only way to taper symmetrically to a point: `5 → 3 → 1`
  reaches an apex, `4 → 2` cannot. Blades, beaks, horns, spires and noses need
  it. The cost is that the default pivot is fractional, so the part sits on a
  half-voxel lattice and the ASCII tools annotate `step=0.5` and round.
  **Applying that half-offset consistently down a whole axis of the model is
  nearly free** — everything still centres on `x=0`, parts still meet without
  seams, and only the ASCII precision suffers. Mixing parities on one axis is
  what creates seams.

  The one thing never to do is take the middle option: an integer pivot on an
  odd width. It looks tidier and it puts the part half a cell off centre, so it
  is not mirror-symmetric with itself and an l/r pair built that way trips
  **W06**.
- **Making two parts in a chain join flush:** work in *world* cells, not local
  ones. Push the parent's last Z-slice and the child's first Z-slice each
  through `v_world = Σ position + (v_local − pivot.pos)` and check they occupy
  the same world cells. Two segments with different `H` and different `pivot.y`
  will look adjacent in the file and leave a step in the render.
- **Mirroring an l/r pair by hand:** a part of width `W` with local pivot `q`
  mirrors to a part with local pivot `W − q`, and its voxel rows reversed. So
  a right-side part occupying cells `a..b` needs its partner at `−1−b..−1−a`
  in parent space. `cuboidy-part mirror` does all of this for you and is the
  reason to prefer it over hand-reversing strings.
- **Mirroring a rest rotation** is not covered by that tool and W06 will not
  check it: across the YZ plane, Euler `[x, y, z]` mirrors to `[x, −y, −z]`.
  X is unchanged; Y and Z negate. Any pair of angled limbs needs this.
  (H02 will not catch a mistake here, and it is noisier than it looks. Its
  exemption is the **exact default triple** `[W/2, 0, D/2]` — `y` included —
  not "any centred value". So `[2.5, 0, 2.5]` on a 5×h×5 part is silent, while
  `[1.5, 3, 1]` on a 3×6×2 part hints even though it is dead centre in X and Z.
  Raising a pivot to a joint on an odd-width part therefore always hints. It is
  only a hint, `--strict` still passes, and the right response is usually to
  ignore it.)
- **Put the pivot on the face that touches the parent.** For a limb hanging
  downward that is the top, `y=H`, inner edge, so it swings from the
  shoulder or hip rather than the foot. For a body segment in a chain — a
  fish's spine, a tail, a neck — it is the *front* face, `z=0`, at mid-height.
  The grid bound is inclusive, so `y=H` and `z=D` are legal pivot coordinates
  and do not warn.
- **The default pivot is not centred in Y.** `[W/2, 0, D/2]` puts it on the
  floor of the grid, which is what you want for something standing on the
  ground and wrong for anything that hangs, swims or joins mid-height. Those
  need an explicit `y`.
- A child's manifest `position` = where the child's pivot sits **in the parent's
  pivot space** (offset from the parent's pivot).
- World placement, **when no ancestor is rotated**:
  `v_world = Σ ancestor.position + (v_local − pivot.pos)`.
  Verify exact cells with `cuboidy-query --at=x,y,z` / `--core`.
- **Use it backwards, because that is the direction you actually work in.** To
  land a part's cells on the world interval starting at `a`:
  `position = a + pivot.pos − Σ ancestor.position`. Dropping the ancestor sum
  on a grandchild is the classic off-by-a-parent bug, and it renders as a part
  floating one cell away from where it belongs.
- **The moment any ancestor carries a rest rotation, that sum is wrong** — and
  since rest rotation is the thing this guide recommends for anything diagonal,
  expect to need the real rule. A child's `position` is rotated by the parent's
  accumulated rotation before it is added:

  ```
  W.quat = parent.W.quat · q_rest        q_rest = q_rotation · q_pivot
  W.pos  = parent.W.pos  + parent.W.quat · position
  ```

  Animated `scale` is the one thing that does **not** propagate: it resizes the
  part's own voxels and leaves its children alone.
- **Mirror pairs** (l/r) parented to a part: compute the symmetric position,
  don't eyeball it. For pivot.x = p on a width-w child, the two positions that
  mirror about the parent centerline are symmetric around it — get it wrong and
  one side juts out (cost me a visible asymmetry once).
- **Generate symmetric / repeated parts, don't hand-duplicate**: author one
  side (`ear-l`), then `cuboidy-part duplicate ears.json ear-l ears.json ear-r`
  and `cuboidy-part mirror ears.json ear-r` — the mirror reflects voxels /
  pivot / sockets in place, so you never redo the L/R voxel math. (`mirror`
  alone flips a part where it is; `duplicate` makes the copy to flip.) The
  manifest `position` is still per-part; lint **W06** flags an l/r pair whose
  assembled geometry isn't X-symmetric.
- **Name mirror pairs `<base>-l` / `<base>-r` to get W06 at all.** The check
  looks for a name ending in `l` whose preceding character is `-` or `_`. So
  `foreleg-l` / `foreleg-r` is checked and `leg-fl` / `leg-fr` is silently
  **not** — the limb identifier has to end at the side letter, not carry it in
  the middle.
- **Rotational repetition is the other half of this**, and it is easier than
  mirroring: a wheel, a fan, a gear, a crown of spikes is *one* part duplicated
  N times, each copy differing only by its manifest `rotation`. No mirror
  arithmetic, no W06 — just `cuboidy-part duplicate` and a rotation per copy.
  Reach for it whenever a shape repeats around an axis rather than across a
  plane. (Skip the mirror rules above entirely if your subject has no l/r pair.)

## Authoring an accessory for someone else's socket

A hat, a sword, a lantern — a model built to attach to a socket on a host model
you may never see. The whole rule is:

- **The guest's model origin is the point that lands on the socket** (SPEC
  §6.12) — world `[0, 0, 0]` in your own coordinate space, not any one part's
  pivot. In practice: give the root part `"position": [0, 0, 0]` and put its
  `pivot.pos` at whatever point of its own geometry you want coincident with
  the socket — the middle of a grip, the underside of a hat's brim. That makes
  the origin and the joining point the same place, which is the arrangement
  every reader will assume.
- The socket's rotation orients you. With an identity socket rotation, the
  guest's `+Y` points along the host socket's `+Y`.
- Everything else in the accessory hangs off that root as normal children.

The host side has one job in return: **publish the socket**. A socket declared
in a geometry file is internal — the manifest's `sockets` map is what offers it
to anyone else, under a model-level name:

```json
"sockets": { "weapon": { "part": "hand-r", "socket": "grip" } }
```

Publish every socket you intend an accessory to use, and only those. The
published name is what a consumer holds, so it survives you renaming the part
or the socket underneath it. Lint will tell you if it points at a socket that
is not there.

Author against the *contract* — where the socket is, how big the attachment
region is, which way is up — not against the host's geometry. Two models built
this way by people who never saw each other's files will fit.

There is no way to preview the join: nothing composes two models. Verify it
with `cuboidy-query`, and expect to check the fit for real only once something
assembles them.

## Two things worth knowing exist

Easy to miss reading the spec straight through, and each removes a class of
hand-math:

- **Rest rotation** (`rotation` on a manifest part, degrees, ZXY). A part can
  sit at an angle without you rotating its voxels: a tilted head, a swept-back
  wing, splayed legs. Authoring a diagonal shape into a voxel grid is painful
  and looks like stairs; authoring it straight and turning the part does not.
  It rotates around the part's pivot and children inherit it, so put the pivot
  at the joint first. Remember the projections will not show the rotation
  (see Gotchas) — `cuboidy-snap` will.

  Signs, for a model facing −Z (all three are easy to get backwards):

  ```
  +X  swings a downward-hanging limb FORWARD
  +X  pitches a backward-pointing tail DOWN
  +Z  tilts a part's top toward −X
  ```
- **Splitting geometry across files** (`"geometry": ["body.json", "gear.json"]`
  in the manifest). Part names stay unique model-wide, so this is purely
  organizational — worth it when a model has separable pieces you want to work
  on without scrolling past everything else. The files can share one palette by
  each naming the same file: `"palette": "palette.json"`, which is also how you
  keep colors consistent across them.

## Joints

A joint has to hold shut through every pose without its two parts fighting for
the same pixels. Those pull against each other, and which way you resolve it is
a choice made when the parts are built, not a cleanup pass afterwards.

### The default treatment: break the tie with `scale`

**Where a joint's two parts are different colours and their surfaces would be
coplanar, give ONE of them a `scale` of about `0.99` on the two axes ACROSS
the bone, leaving `1.0` along it.** Do this as a matter of course rather than
as a repair. Getting a joint to clear by shape alone is genuinely hard — it
depends on the parent's taper, the child's taper and the swing, and it has to
come out right on every model — while a scale offset is one line in the
manifest.

What removes the fight is that the two parts stop being the same size. That
is worth stating as the rule, because "scale the child by 0.99" is only one
way to get there and following it literally produces two failures that look
like the offset not working. Measured on a same-section pair, 120 visible
clashes at rest:

```
no scale                       120
child  0.99                      0
parent 0.99                      0
BOTH   0.99                    120   <- back where it started
```

- **Either side does.** Prefer shrinking whichever part is BURIED, so its
  faces retreat inside the covering one; where the buried part is the parent
  — a neck swallowed by a head — that means scaling the parent, and "scale
  the child" points the wrong way.
- **Rest `scale` is NOT inherited** (verified against `--transforms`: a child
  of a `0.99` parent reports `1.0`). So a flat `0.99` on every part of a
  constant cross-section chain makes each neighbouring PAIR equal again, and
  the seams come back — the last row above, in chain form. Grade it instead:
  `0.99 / 0.98 / 0.97` down the chain is what inheritance would have produced.

Two more conditions, and both matter:

- **The pivot must sit at the cross-section centre.** Scale moves each face
  away from the pivot, so a pivot on one face leaves that face exactly where
  it was and moves only the opposite one. The joint then still fights on one
  side, and it looks like the offset "did not work" when it half-worked.
- **Only if the colours differ.** Two coincident surfaces in the same colour
  shade identically, so whichever the renderer picks draws the same pixel.
  The reference humanoid carries forty-four of those and shows nothing.
  `cuboidy-clash` reports only differing pairs for this reason.

Along the bone stays `1.0` because that axis is the overlap holding the joint
shut; shortening it opens the seam the overlap was there to cover.

Measured: two same-sized segments meeting flush dither visibly in
`cuboidy-snap`, and the same pair with the child at `[0.99, 1.0, 0.99]`
renders a clean boundary. The floor is lower than the rule — `0.999`, three
thousandths of a voxel, was already clean, because a rasterizer only has to
break a tie. The rule asks for `0.01` anyway: a GPU depth buffer has finite
precision and can still fight at long range on a separation that small, and
that case has not been measured. `cuboidy-clash --max-distance` defaults to
half the rule's offset so a joint fixed this way reads clean.

The shape work below is for parts that are in the wrong PLACE — an arm inside
a thigh. It is not the first thing to reach for when two surfaces merely
coincide.

### Two rules that were here and were wrong

Both were written from a model author's report without being checked, and
both are withdrawn. They are named rather than deleted because the reasoning
that produced them is easy to repeat.

**"Detail colour does not belong in a part's outermost column."** There was
never anything wrong with it. Two faces of ONE part can never overlap: a
part's voxels sit on an integer grid and the mesher merges nothing, so its
coplanar faces are always adjacent tiles, one cell apart. What produced the
finding was `cuboidy-clash` comparing that gap against a limit written in
VOXELS, which assumed every drawn face is one cell square — so a part
carrying `scale [0.93, 1, 0.93]` had its faces 0.93 apart, under the
constant, and every colour boundary on it was reported. The check now
normalises by the faces' own size and a yeti's claws score zero wherever
they sit. Put markings where they look right.

**"Matching corner profiles down a constant cross-section chain clash
however far you scale them."** Measured on a two-segment chain: matching
rims score 40 unscaled and **0** with the child at `0.99`; a plain prism
child scores 24 unscaled and **0** scaled. The scale offset fixes both, and
differing profiles are a smaller improvement than it, not a substitute.

The common error is worth more than either rule. A number came back, and
rather than ask whether the number was true, a mechanism was invented that
would explain it — "both faces belong to one part, so scaling moves them
together" is a satisfying sentence about a thing that was not happening.
Check that a finding is real before explaining why it is.

**Prefer abutting cross-sections to embedding.** Two parts whose end faces meet
exactly, with no shared cells, have nothing to fight over. The reference fox's
tail segments are built this way, so it is not a theoretical option. It costs
you the margin that hides a gap when the joint bends, so it suits a chain that
turns through small angles — a tail, a neck, a spine — and not a shoulder.

**When you do embed, overlap ALONG the bone and inset ACROSS it.** The child's
buried end keeps its length inside the parent, which is what stops the seam
tearing open, and is narrowed on the axes across the bone so its sides sit
strictly inside the parent's rather than flush with them. Flush is what
clashes; inside is invisible.

**Eroding the child alone can make it worse, and this surprises people.** (This
and the paragraph before it are the shape route, kept because it is the right
answer when a scale offset is not available — a part whose pivot cannot move to
its cross-section centre, or a fight that survives the offset. The offset above
is what to try first.) Chain
segments usually taper identically at both ends, so shaving one cell off the
child just re-matches the parent's own end taper and the two are flush again at
the new width. Measured on one yeti: 88 visible clashes went to 44 by eroding
alone, with `forearm/hand` actually rising 8 → 11. The treatment is a **pair**
of edits per joint — erode the child's buried layers, **and square off the
parent's socket end** so the narrowed core sits inside a straight-walled
opening. Squaring adds material, so it thickens the elbow or knee slightly
rather than thinning anything. The same yeti went 88 → 2 once both halves were
applied.

**No animation will part faces whose normal is the axis they turn about.** A
rotation about X moves nothing along X. So the side faces of a constant
cross-section chain — `arm/forearm/hand`, `thigh/shin/foot`, all hinging about
X — stay coplanar in every pose of every clip, and every one of those seams has
to be built apart. This is worth knowing before you decide a seam will "sort
itself out in motion": some will, and this class provably will not.

**Volume overlap is not the thing to minimise.** A joint is *made* by burying
the child in the parent. `cuboidy-overlap` exists to find the other kind — two
parts holding the same space that the rig does not join, an arm inside a thigh
— and it reports how many rig steps apart each pair is so you can tell them
apart: 1 is a joint, 2 is a part reaching past its parent, 3 or more has no
structural reason to touch. Chasing the total down is how you take a rig apart.

**Some overlaps are the brief, not the model.** Check the arithmetic before
reworking geometry: a 16-wide box holding two 6-wide arms and two 5-wide legs
needs 22 units of width and does not have them, so an ape build with hanging
arms cannot have them laterally disjoint at any pivot. When a fault turns out
to be a constraint conflict, say so and hand the choice back — widening the
box, thinning the limbs and abandoning the pose are all decisions above the
model.

## Shape / rounding

- You don't need a true sphere. **Narrow the layers toward top and bottom**
  (egg silhouette) + **cut the top/back corners** → reads as "rounded, not a cube".
- **Design the palette against pairs that will touch, not as a list.** Three
  authors here shipped a colour pair that was individually pleasant and
  mutually invisible where the geometry put them adjacent — a blade's fuller,
  a fish's fins, a staff against a skirt — and none noticed until the render.
  Flat shading removes most of the cue you are unconsciously relying on, so a
  1-cell feature disappears unless its *neighbour* is high-contrast. Sketch the
  adjacencies, not the swatches.
- **A near-black sole is the cheapest readability win there is.** One dark row
  under a figure gives the whole silhouette a ground line.
- **Flat-shaded voxels = one color per cell.** You cannot shade a single face.
  "Shadow under the bangs" has to be a darker *cell*, which is then visible from
  that direction — so use shading sparingly or it looks muddy/dirty. Let SHAPE
  carry the 3D, not lots of color bands.
- **Surface relief on a face: keep it ~1 cell.** 2+ cells of forward
  protrusion reads as a shelf or a brim rather than soft hair. This is about
  *detail worked into a surface*, where a hard step contradicts the material.
- **Appendages are the opposite, and the rule above has misled people into
  starving them.** A beak, an ear, a horn, a fin is a shape in its own right:
  at 1–2 cells it reads as a flag or a sticker glued to the head, and it needs
  the depth its silhouette implies. Ask which one you are making — a feature
  *on* a surface, or a thing sticking *out* of one.
- **Overlap joints by 1–2 cells.** Rigid parts that merely touch read as a
  stack of blocks; parts that interpenetrate slightly read as one creature.
  This is what makes "head sunk into the shoulders" possible at all.
- **Large flat colour regions are how an animal becomes identifiable** — black
  stockings, a white bib, a white tail tip, dark ear backs. The warning against
  shading is about *gradients and speckle*, not about markings. A species with
  a colour signature needs it at any size.

## Animation

- **Watch the clip: `cuboidy-gif`.** `cuboidy-snap` draws the rest pose only,
  so it is not the tool for the half of the format that moves. `cuboidy-gif`
  is:

  ```
  cuboidy-gif <dir> --anim=walk --angle=side --out=<scratch>/walk.gif
  ```

  **The camera is fixed across every frame** — fitted to the union of the whole
  clip — so the model does not rescale as it moves and a foot's height IS
  comparable between frames. That is exactly what a sequence of snaps cannot
  give you, since snap re-fits per model. `--orbit` turns the model on the spot
  instead, which is how to look at something that has no clips at all.

  Two things to know before a batch: it **defaults to writing inside the model
  directory** (`<dir>/<model>-<clip>.gif`), so pass `--out` or the package
  ships with a diagnostic in it; and a GIF is 256 colours, so leave `--ss` at 1
  for voxel art rather than antialiasing into a quantised palette. `--loops=3`
  is worth knowing too — a 0.6 s walk played once is over before the eye has
  read the gait.
- **Nothing MEASURES whether moving parts collide.** Lint sees only the rest
  pose. A gif will show you a gross intersection — a sail through a tower, a
  tail through a flank — but a limb that passes one voxel inside a garment for
  two frames reads as contact, and only sweeping the animation and probing with
  `cuboidy-query` settles that one.
- **Key an attribute on every keyframe you want it to move through.** Omitted
  fields inherit from the previous keyframe (§6.5 carryover), so keying `rot`
  on eight times and `pos` on four does not give `pos` a coarser curve — it
  gives it a *flat* one between the keys where it is absent, and the part
  visibly stair-steps. Carryover is for values that genuinely hold, not for
  brevity.
- **Motion made of several parts is a phase problem.** A walk, a wingbeat, a
  swimming body — each part does much the same thing, displaced in time.
  Getting that displacement right is most of what makes it read; make the
  offset explicit when you author the keys rather than eyeballing each part.
- **Write a contact probe before you trust any pose.** This is the biggest
  single source of error in the format and the eye cannot catch it. A dozen
  lines of forward kinematics that print the world position of every contact
  point — each foot, a staff tip, a talon — at ~16 samples across the clip.
  Two things to read off it: contact Y should sit at ~0 through stance, and
  contact Z should slide backward at the *same rate* for every grounded part.
  Authors here have shipped a first pass with a staff tip 1.3 voxels
  underground, another with all four feet through the floor, and neither was
  visible in a render. Build the probe first; it reshapes the keyframes instead
  of forcing a retrofit onto them.
- **Derive ground contact, don't invent it.** If a pelvis bob is authored
  independently of the leg angles, the feet float or sink. Choose where the
  foot plants, then solve the knee or the hip height from it. The rest pose
  with straight legs is the *maximum* hip height, so every walk pose sits at or
  below it.
- **Rotating a grounded part about a pivot that is not its contact point
  drives that contact through the floor**, and you must cancel it with `pos`
  on the same key. A boot pivoted at the heel, rotated −8° for toe-off, puts
  the toe of a 3-deep foot `3·sin8° ≈ 0.42` voxels underground. Every stance
  key needs the compensation.
- **Check the loop closes — in orientation, not in numbers.** Sample at
  `duration` and at `0.0` and compare. For an oscillation they should be equal.
  For a **revolution** they must differ by a whole multiple of 360°: a part
  turning once per loop keys `duration` at `0 ± 360`. Key it back to a literal
  `0` and the final segment unwinds the whole turn — the wheel spins forward
  then snaps backwards, and neither lint nor a rest-pose render can see it.
- **`rot` interpolates component-wise on the Euler triple**, not as a
  quaternion slerp. This is why a full turn is expressible at all, and it is
  why a spin should be keyed as quarter turns: every segment stays under 90°,
  where the two interpretations agree, and equal angle over equal time is
  constant rate by construction.
- **Never ease a constant-speed rotation.** Any curve on a segment of a steady
  spin puts a velocity discontinuity at each keyframe — a stutter once per key,
  forever. Easing is for motion that accelerates.
- **A sparse periodic curve can be exact.** With one key per quarter period,
  alternating `in-sine` (on keys at an extremum) with `out-sine` (on keys at a
  midpoint) reconstructs a true cosine: the two presets are `1−cos(uπ/2)` and
  `sin(uπ/2)`, which meet with matching slope at every key. Measured against
  the analytic cosine this is exact to floating point. The intuitive choice,
  `in-out-sine` everywhere, instead stalls the motion at all four keys.
- **`ease` is per attribute, not per component.** One curve governs all three
  Euler angles of `rot` together, so two axes of the same part cannot be given
  different phases at low key density. Split them across two parts if you need
  that. The same bites harder on `pos`: a part that must cancel its parent's
  vertical dip wants the parent's curve on Y, while a stance slide on Z wants
  `linear`, and one `pos` cannot be both. Pick the one that shows and accept a
  little drift on the other, or move one of the two jobs to another part.

## Verification (procedure — don't trust your head-math)

**Read the output, not the exit status.** Measured 2026-08-24, and the two CLIs
disagree, which is the kind of thing a batch script gets wrong once and then
silently forever:

```
$ cuboidy-lint models/fox --strict          # clean: prints nothing
$ cuboidy-lint broken/ --strict
broken/tail.json: error: line 27: parts.0.voxels.1.0: row length 5, expected W=6 [wrong-arity]
$ echo $?
0                                            # <- lint reports the fault and exits 0

$ cuboidy-snap broken/
cuboidy-snap: broken/tail.json: line 27: parts.0.voxels.1.0: row length 5, expected W=6
$ echo $?
2                                            # <- snap refuses, and writes nothing
```

So **a script that gates on `cuboidy-lint`'s exit code passes every broken model
it is given** — and a batch that does that produces thirty packages and reports
success, which is the one failure a batch cannot recover from. Gate on whether
anything was printed. `cuboidy-snap` can be gated on status, but that is a late
and expensive way to learn what lint would have said per part.

- `cuboidy-lint --strict` — catches row-width / layer-count / palette-range
  typos. Hand-writing WILL produce these; lint is the safety net. **The rule
  `--strict` applies is simply: every `W` fails it, no `H` does.** That is the
  whole acceptance criterion — clear the warnings, ignore the hints. (Tip: define
  the FULL palette up front so you never renumber indices. If the palette is
  inline, tolerate W03 "unused color" during blockout by linting without
  `--strict`; if it lives in a shared `palette.json`, W03 does not apply at all
  — a shared palette exists so each file can use a subset — so you can define
  every colour up front and run `--strict` from the first pass.)
- `cuboidy-view` — fast ASCII per axis; best for checking exact rows & symmetry
  **on an axis-aligned model**. It cannot draw a rotated part (see Gotchas), so
  the more a model leans on `rotation`, the less this tool tells you: a
  windmill's sails show up as a vertical stack rather than a cross. Reach for
  the snap instead once parts start turning.
- `cuboidy-snap` — real PNG from many angles; **reveals what ASCII hides**
  (protrusions, true proportions, muddy shading). Always snap before "done".
  **The side view is where proportion dies.** A model designed from the front
  will pass the front view and be a plank or a lamp post from the side; three
  of the models in this repository were rebuilt after exactly that. Author the
  side silhouette first, or at least check it first. Note also that snap
  auto-frames each model, so two renders of different poses are *not* to the
  same scale — never compare heights across frames by eye.
- `cuboidy-gif` — the only view of a clip. **A walk shipped unwatched is a walk
  nobody checked**, and neither lint nor snap can tell you the feet skate or a
  leg passes through the body. Its camera is fixed across the clip, so it is
  also the one render whose frames may be compared to each other.
- `cuboidy-clash` — the one fault no other check sees: two surfaces in the same
  place, facing the same way, in DIFFERENT colours. The renderer cannot choose
  between them, so it decides per pixel — a dithered cross-hatch here, a flicker
  that follows the camera in anything with a depth buffer. It names both sides,
  part and part-local voxel and which face, so the finding points at a row you
  can edit. Lint is silent about it by construction: it is a property of the
  assembled model, not of a file.
  **It checks every clip as well as the rest pose, and you want that.** The
  rest number does not predict the others and is not a weak version of them:
  across sixteen mobs, a yeti reading **2** at rest reached **218** partway
  through its attack, and a slime reading 6 reached 128. `--rest-only` is
  twenty times quicker and is the wrong thing to reach for by habit.
- `cuboidy-overlap` — the OTHER overlap: two parts holding the same *volume*,
  as against two surfaces in one place. Read the `not joined:` lines first;
  the census below them is context, and its total is not a number to drive
  down (see **Joints**). Note `dead` is computed from the poses it sampled, so
  it is only as trustworthy as the sweep — the default step count is even
  precisely so the midpoint of every swing is one of them.
- `cuboidy-query --colors` — cells and drawn faces per part and palette slot.
  **The only check in the toolchain that sees colour at all.** Lint is
  structural, `cuboidy-clash` only asks whether two colours DIFFER, and
  `cuboidy-overlap` counts cells: a part refilled with the wrong index passes
  all three and renders as a band across the model. This happened — an author
  eroding a joint filled the arm sockets with `9` where the arm is `a`, and it
  was caught by a human looking at a render, which is a catch that stops
  working the moment nobody looks. Census before an edit and after; every line
  that moved should be one you meant to move, and an index appearing in a part
  that had none of it is a mis-typed fill.
- `cuboidy-query` — exact cell lookup; verify attachment & symmetry numerically.
  **`--at` takes CELL INDICES, not positions.** A fractional coordinate returns
  `.` whatever is actually there: it neither floors nor rounds, so probing a
  cell's CENTRE — `x + 0.5`, which is exactly what the pivot section above
  teaches you to think in — misses every time, and misses silently. It reads as
  empty space rather than as a mis-aimed probe, which is the trap.
  Measured by sweeping a solid row in quarter-steps on two models that both
  report `contains half-voxel offsets`: every integer returns the colour, every
  fraction between them returns `.`. `--core` walks whole cells too — a ten-cell
  span comes back as ten characters.
- Do not treat the numeric probe as the weaker check. It catches what the eye
  cannot: a colour edit that half-applied, a limb passing through a garment,
  two cells that should be symmetric and are one apart.

## When a check fails (procedure)

| | |
|---|---|
| **Lint printed anything** | Fix and re-lint. Never carry a finding into the next part; it gets buried. Remember the exit code will not tell you |
| **Snap looks wrong in silhouette** | Go back to the **manifest**, not the voxels. Silhouette is positions and sizes |
| **Snap looks wrong in detail** | Voxels. Fix and re-snap |
| **Lint names a geometry file you never declared** (usually `voxels.json`) | The manifest failed to parse and lint fell back to the default name. Fix the manifest error printed above it — this line goes away with it |
| **A part is missing from the render** | Its geometry did not resolve. Check the name matches the manifest exactly, and that no other geometry file defines the same name — a duplicate makes the model unresolvable rather than ambiguous (§11) |

**Detail on wrong proportions is wasted work.** If the blockout silhouette does
not read, no amount of face detail rescues it.

## When to stop (procedure)

For **a finished model**: when the side and a three-quarter view both read as the
thing it is meant to be, and lint is clean under `--strict`.

For **a placeholder** — one of thirty, standing in until real art exists — the bar
is lower, and worth stating so it is not silently exceeded:

- lint clean under `--strict`
- the silhouette is identifiable from the side and from a three-quarter view
- it is not a plank, a lamp post, or a cube with a face

**Two edit→snap loops, then stop.** A placeholder polished over five loops is a
finished model made by accident, and that effort belongs to whatever replaces it.

## Naming parts

Names are how animation binds (§6.8): a clip animates `foreleg-l`, and any model
with a part of that name can play it. **A name matching nothing is a warning, not
an error** — a clip aimed at a misspelled part silently animates nothing.

So a convention is worth keeping even when no clip is shared, because the same
names are what sockets and consuming code read.

**Bilateral parts take `<base>-l` / `<base>-r`, and the side letter must end the
name.** This is not cosmetic: W06 looks for a name ending in `l` whose preceding
character is `-` or `_`. `foreleg-l` / `foreleg-r` is checked; **`leg-fl` /
`leg-fr` is silently not** — which matters because the front/back-left/right
spelling is the natural one to reach for on a quadruped, and it is the one that
turns the symmetry check off. Put the side last: `leg-front-l`, not `leg-fl`.

### Skeletons that recur

Not normative — the format does not care — but a consumer that wants clips or
socket lookups to carry between models needs some agreed vocabulary.

```
Humanoid    root → torso → head
                         → arm-l → hand-l          (and -r)
                 → hips  → thigh-l → shin-l → foot-l

Quadruped   body → neck → head → ear-l
                 → leg-front-l → paw-front-l       (and -r, and -back-)
                 → tail-1 → tail-2 → …

Bird        body → neck → head → beak
                 → wing-l
                 → leg-l → foot-l
                 → tail
```

**W06 only covers `l`/`r` pairs sharing a parent**, so on any of these the pairs
below the first joint — `shin`, `foot`, `paw` — escape it entirely. Verify those
with `cuboidy-query`.

## The rest pose is what people see

**There is no bind pose in this format.** The rest pose is the pose when no
animation is active (§2), so a model with no clip playing — or a consumer that
does not animate at all — shows it permanently. `cuboidy-snap` draws it too.

**So do not author a T-pose.** T-pose exists in skinned pipelines to make weight
painting tractable, and there are no weights here — parts are rigid boxes on
pivots. A T-posed Cuboidy model is just a model standing with its arms out.

Author a natural resting stance: a humanoid with arms at its sides, a quadruped
with its legs under it, a bird with its wings folded.

**Arms hanging perfectly vertical will bury the shoulder in the torso**, and if
the arm and torso widths differ in parity that join lands on a half-voxel seam.
A few degrees of `rotation` outward usually reads better — check it in the snap
rather than deciding by arithmetic.

## Sharing a clip between models

A clip's `rot` is **relative to the rest pose** (§6.5). So a shared clip behaves
the same on two models only if **both their part names and their rest poses
match**. Names are checkable; **rest poses are not** — there is no such thing as a
wrong stance, so nothing can flag two models that disagree.

Sharing pays when a family is large and its stances were aligned deliberately. It
does not pay for two or three models, and it costs something real when the models
are supposed to move differently: a bear and a rabbit sharing one walk are a bear
and a rabbit that move identically, which throws away a way of telling them apart
at a distance.

**Default to a clip per model.** Reach for a shared one when the family is big
enough to pay for the coupling, and say so in the brief rather than discovering
it later.

## Gotchas

- **Odd vs even widths between parent/child** create half-voxel seams. Align
  grids (same parity) where a clean join matters — and see the pivot rule
  above, which is the other half of the same problem.
- ASCII views can look fine while the real render is awkward — **the snap is the
  source of truth** for appearance.
- **W06 only checks l/r pairs that share a parent.** `thigh-l` / `thigh-r`
  under `hips` are checked; `shin-l` / `shin-r` under `thigh-l` / `thigh-r`
  are not, because their parents differ. Most limb pairs below the first joint
  therefore escape the symmetry check entirely — verify those yourself. (The
  check also ignores rest rotations, so a mirrored `rotation` pair is neither
  validated nor penalised.)
- **Overlap joints in the SAME colour, and know what that does and does not
  buy.** The advice to overlap parts by one or two cells is right, and it is
  also what creates this: where two parts hold one cell, both emit a face on
  the same plane facing the same way, and if their colours differ the renderer
  has no tie-break. Painting the buried cells the covering part's colour is a
  real improvement and it is **not a fix**, because it only holds while the
  cells stay buried. Measured on one yeti: rest-pose clashes 146 → 0, while
  the same model's walk went 61 → 28 and its attack 84 → 36. A clip swings the
  child out and the recoloured cells come into view still fighting. **The
  standing treatment is the 0.99 scale offset in Joints**; recolour is what
  you do to the cells that genuinely never surface, which `cuboidy-overlap`
  calls *dead*.
  `cuboidy-clash` finds them; the reference humanoid scores zero while
  carrying forty-four same-coloured coincidences, so this is achievable rather
  than inherent.
- **A rotated part is not drawn rotated by `cuboidy-view` / `cuboidy-query`.**
  They place its pivot correctly but keep its voxels axis-aligned, and warn.
  Only `cuboidy-snap` shows the true orientation, so a model that uses
  `rotation` has to be checked by eye rather than by ASCII. The warning is one
  line *per rotated part*, so on a rig with a dozen of them the header drowns
  the grid — treat the ASCII tools as a final symmetry audit on such a model,
  not as the working view.
- **`half-voxel offsets present` does not mean you wrote a fractional pivot.**
  A rest rotation puts cells on non-integer world coordinates too, so a model
  with entirely integer pivots still gets the notice. It reports the state of
  the world grid, not a mistake.

## Case study: cat-girl (what the passes caught)

- **Blockout snap** immediately showed the head was too big for the torso/legs
  (and hair would only make it worse) → lengthened body & legs 6→7 *before*
  spending any effort on detail. Cheap fix at the right time.
- **Detail snaps** caught things ASCII never could: an early version's bangs
  protruded ~2 cells and read as a shelf/brim (fixed to ~1 cell); a near-black
  mouth voxel read as a central smudge (softened to a 1-cell pink mouth);
  heavy multi-tone hair shading looked muddy (reduced to crown sheen only).
- A `sidelock-r` mirror position was off by one unit (asymmetric, jutting past
  the head) — only obvious once derived/queried numerically.
- Net: a clean, cute, fully hand-written model with rounded head + soft bob +
  matched-width legs, reached in a handful of edit→lint→snap loops — no
  generator. The format is genuinely hand-authorable when you work in passes
  and let the snaps drive the fixes.

## What a brief must supply (procedure)

This document deliberately decides none of these. A commissioning brief that
leaves any of them out gets thirty models that do not belong in the same world:

| | why it cannot be defaulted here |
|---|---|
| **Palette** | The single biggest source of "these do not go together" |
| **Scale** — voxels per world unit, and one reference height | A model is dimensionless until something says what a voxel is worth |
| **Skeleton per subject** | Which shape above each subject uses, and what to do with the ones that fit none |
| **Where packages go, and how they are named** | The consumer's lookup rule, not the format's |
| **Finished or placeholder** | Sets which stopping rule applies |
