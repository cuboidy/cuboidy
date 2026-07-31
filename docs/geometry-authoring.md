# Authoring Cuboidy models by hand — workflow & tips

Notes captured while hand-building characters, and the companion to `SPEC.md`
for anyone — human or model — authoring from scratch. The spec says what is
legal; this says what tends to work.

The golden rule: **write the geometry file by hand and let the CLIs give you
feedback** — do not generate it from a script (that defeats the point of a
readable format and hides what hand-authoring can do).

## The loop (like real 3D modeling)

```
edit voxels.json  →  cuboidy-lint  →  cuboidy-snap  →  LOOK at the PNG  →  fix
```

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

- **The guest's root part's pivot is the point that lands on the socket.** So
  that root part's manifest `position` is `[0, 0, 0]`, and its `pivot.pos` sits
  at whatever point of its own geometry you want coincident with the socket —
  the middle of a grip, the underside of a hat's brim.
- The socket's rotation orients you. With an identity socket rotation, the
  guest's `+Y` points along the host socket's `+Y`.
- Everything else in the accessory hangs off that root as normal children.

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

## Shape / rounding

- You don't need a true sphere. **Narrow the layers toward top and bottom**
  (egg silhouette) + **cut the top/back corners** → reads as "rounded, not a cube".
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

- **You cannot render an animated pose.** `cuboidy-snap` draws the rest pose
  only, so the "look at it" loop this guide is built on does not cover the half
  of the format that moves. The workaround is to bake: sample the clip at time
  *t*, fold the result into a scratch copy of the model, and snap that. Two
  things make it more than a few lines, so budget for them:
  - Rotations **compose as quaternions** (§7.7), so you cannot add the sampled
    Euler angles to the manifest `rotation`. Multiply the quaternions and
    convert back to ZXY Euler — and there is no inverse of
    `quatFromEulerZXYDeg` in the codebase, so that conversion is yours to
    write.
  - `scale` and `visible` have no manifest equivalent, so **a baked frame
    silently lies about them.** A part that should be hidden or squashed will
    render at full size. Bake covers `rot` and `pos`; check the rest by
    sampling numbers.
- **Nothing checks whether moving parts collide.** Lint sees only the rest
  pose, and so does every render. A long rotating member — a sail, a tail, a
  limb against a garment — has to be checked by sweeping the animation and
  measuring, or it will pass everything and still intersect. This is the one
  class of defect the whole documented loop cannot see.
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
- **Derive ground contact, don't invent it.** If a pelvis bob is authored
  independently of the leg angles, the feet float or sink. Choose where the
  foot plants, then solve the knee or the hip height from it. The rest pose
  with straight legs is the *maximum* hip height, so every walk pose sits at or
  below it.
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
  that.

## Verification (don't trust your head-math)

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
- `cuboidy-query` — exact cell lookup; verify attachment & symmetry numerically.
  **On a half-offset axis, an integer `--at` probe lands between cells and
  returns `.`** — it looks like empty space, not like a mis-aimed probe. The
  header does say `contains half-voxel offsets`, so read it. Offset the probe
  by 0.5, or use `--core`, which prints its own `step=0.5`.
- Do not treat the numeric probe as the weaker check. It catches what the eye
  cannot: a colour edit that half-applied, a limb passing through a garment,
  two cells that should be symmetric and are one apart.

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
