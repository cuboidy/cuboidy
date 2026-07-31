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

So a cell `(x,y,z)` is `voxels[y][z][x]`. Consequences:

- **Row 0 of each layer = z=0 = FRONT** (the model faces −Z). Last row = back.
- **First char = x=0**; +X is the model's right.
- For a front-facing face, **make each row a palindrome** → automatic L/R symmetry.

## Pivots & the manifest

- **A voxel cell fills the unit interval after its index.** Cell `x` occupies
  `[x, x+1)`, so its centre is `x+0.5`. Almost every symmetry surprise in this
  format comes from forgetting that. In particular, mirroring across a pivot
  plane sends the cell at `x` to the cell at **`−1−x`**, not to `−x`.
- **Make a part's width and depth EVEN if you want it centred.** The default
  pivot (omit the field) is `[W/2, 0, D/2]`, which centres the part exactly.
  On an even dimension that value is a whole number and everything is pleasant.
  On an odd dimension you are forced to choose, and both options cost you
  something:

  ```
  W=5, pivot 2.5 (default)   cells at -2.5..1.5   centred      projections snap
  W=5, pivot 2   (integer)   cells at -2..2       off by 0.5   projections exact
  W=4, pivot 2   (default)   cells at -2..1       centred      projections exact
  ```

  The integer pivot on an odd width looks tidier and is a trap: the part is
  half a cell off centre, so it is not mirror-symmetric with itself and an l/r
  pair built that way trips **W06**. The fractional pivot is geometrically
  right, but it puts the part and everything parented to it on half-voxel
  world coordinates, and `cuboidy-view` / `cuboidy-query` are integer-lattice
  tools — they round and report `half-voxel offsets present`, so the ASCII view
  you were about to trust becomes approximate.

  Choosing even extents for centred parts avoids the whole dilemma. Keep odd
  widths for parts that are meant to sit off-centre anyway, and for a centred
  part that genuinely has to be odd, take the fractional default and accept
  that you check that one by render rather than by ASCII.
- **Mirroring an l/r pair by hand:** a part of width `W` with local pivot `q`
  mirrors to a part with local pivot `W − q`, and its voxel rows reversed. So
  a right-side part occupying cells `a..b` needs its partner at `−1−b..−1−a`
  in parent space. `cuboidy-part mirror` does all of this for you and is the
  reason to prefer it over hand-reversing strings.
  (H02 will not catch a mistake here. It fires on a fractional pivot only when
  the value is *not* the geometric centre, and it compares the value, not
  whether you wrote the field — an explicit `[2.5, 0, 2.5]` on a 5-wide part
  is exactly as silent as omitting it.)
- **Limbs:** put the pivot at the joint (top, `y=H`, inner edge) so it swings
  from the shoulder/hip, not the foot/hand.
- A child's manifest `position` = where the child's pivot sits **in the parent's
  pivot space** (offset from the parent's pivot).
- World placement: `v_world = Σ ancestor.position + (v_local − pivot.pos)`.
  Verify exact cells with `cuboidy-query --at=x,y,z` / `--core`.
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
- **3D relief (protruding bangs, etc.): keep it ~1 cell.** 2+ cells of forward
  protrusion reads as a shelf/brim, not soft hair (confirmed in snaps).

## Animation

- **You cannot render an animated pose.** `cuboidy-snap` draws the rest pose
  only, so the "look at it" loop this guide is built on does not cover the half
  of the format that moves. Until a tool exists, the workaround is to bake:
  sample the clip at time *t*, fold the result into a scratch copy of the model
  (compose the sampled rotation onto each part's manifest `rotation`, add the
  sampled `pos` to its `position`), and snap that. A dozen lines, and it turns
  animation from guesswork back into edit → snap → look.
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
- **Check the loop closes.** Sample at `duration` and at `0.0` and compare;
  they should be equal. A clip that nearly closes reads as a hitch once a
  second, forever.

## Verification (don't trust your head-math)

- `cuboidy-lint --strict` — catches row-width / layer-count / palette-range
  typos. Hand-writing WILL produce these; lint is the safety net. (Tip: define
  the FULL palette up front so you never renumber indices; tolerate W03
  "unused color" warnings during blockout by linting without `--strict`.)
- `cuboidy-view` — fast ASCII per axis; best for checking exact rows & symmetry.
- `cuboidy-snap` — real PNG from many angles; **reveals what ASCII hides**
  (protrusions, true proportions, muddy shading). Always snap before "done".
- `cuboidy-query` — exact cell lookup; verify attachment & symmetry numerically.

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
  `rotation` has to be checked by eye rather than by ASCII.

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
