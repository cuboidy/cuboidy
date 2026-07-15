# Authoring Cuboidy models by hand — workflow & tips

Notes captured while hand-building characters in `.cvox`. Seed for a future
"author a cvox model" skill. The golden rule: **write `.cvox` by hand and let
the CLIs give you feedback** — do not generate it from a script (that defeats
the point of a human-readable format and hides what hand-authoring can do).

## The loop (like real 3D modeling)

```
edit voxels.cvox  →  cuboidy-lint  →  cuboidy-snap  →  LOOK at the PNG  →  fix
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

A part is a `W×H×D` grid. Inside `voxels { ... }`:

- **H layer-sections** separated by `,` — section *i* is the Y-layer, bottom→top.
- Each section has **D rows** — row *k* is Z.
- Each row has **W chars** — char *j* is X (`.` = air, else a palette index char).

So a cell `(x,y,z)` is: layer `y`, row `z`, char `x`. Consequences:

- **Row 0 of each layer = z=0 = FRONT** (the model faces −Z). Last row = back.
- **First char = x=0**; +X is the model's right.
- For a front-facing face, **make each row a palindrome** → automatic L/R symmetry.

## Pivots & the manifest

- Default pivot = `[W/2, 0, D/2]` (bottom-center). Using exactly this avoids the
  H02 fractional-pivot hint even for odd sizes.
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
  side, then run `cuboidy-part mirror one.cvox ear-l one.cvox ear-r` (or
  `duplicate` for a verbatim copy). The tool writes concrete voxels with the
  pivot/socket reflection done for you, so you never redo the L/R voxel math.
  The manifest `position` is still per-part; lint **W06** flags an l/r pair
  whose assembled geometry isn't X-symmetric.

## Shape / rounding

- You don't need a true sphere. **Narrow the layers toward top and bottom**
  (egg silhouette) + **cut the top/back corners** → reads as "rounded, not a cube".
- **Flat-shaded voxels = one color per cell.** You cannot shade a single face.
  "Shadow under the bangs" has to be a darker *cell*, which is then visible from
  that direction — so use shading sparingly or it looks muddy/dirty. Let SHAPE
  carry the 3D, not lots of color bands.
- **3D relief (protruding bangs, etc.): keep it ~1 cell.** 2+ cells of forward
  protrusion reads as a shelf/brim, not soft hair (confirmed in snaps).

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
  grids (same parity) where a clean join matters.
- ASCII views can look fine while the real render is awkward — **the snap is the
  source of truth** for appearance.

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
- Net: a clean, cute, fully hand-written `.cvox` with rounded head + soft bob +
  matched-width legs, reached in a handful of edit→lint→snap loops — no
  generator. The format is genuinely hand-authorable when you work in passes
  and let the snaps drive the fixes.
