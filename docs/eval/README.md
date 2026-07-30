# Evidence: why geometry moved from `.cvox` to JSON

These are the artifacts behind the decision recorded in
[`../json-migration.md`](../json-migration.md). Deleting a format the project
spent months on is hard to reverse and easy to second-guess later, so the
renders, the votes and the numbers are kept here rather than left in a chat log.

The harness that produced them lives on the unmerged branch
`eval-format-comparison` (`bench/eval/`). It is not on `main` because almost all
of it dies with the migration: the arm structure, the token-variant pricing and
the cvox spec extraction have no meaning once there is one format. The pieces
with a future — the JSON reader, the JSON serializer, the rewritten §7 — are
promoted into the product during the migration rather than kept as benchmark
code.

## Files

| File | What it is |
|---|---|
| `sonnet-5-four-briefs.html` | The four judged pairs. Renders from both arms side by side with shape statistics. Self-contained; open in a browser. |
| `opus-5-windmill.html` | One pair on Opus 5 with the size cap removed and an animation required. Not judged. |
| `votes.jsonl` | Raw blind votes. One line per vote, arm resolved server-side. |

## What was measured

One model, one brief, two arms. Each arm received only the format
specification and the brief — no examples, no feedback, one shot. The result was
parsed, linted, cross-file validated, rendered to a contact sheet, then the two
renders were shown side by side with the formats hidden.

| Measurement | Result |
|---|---|
| Blind pairwise human vote (Sonnet 5, 4 briefs) | **JSON 4–0** (p = 0.125) |
| Reasoning share of output cost | **77–93%** |
| Output tokens (Sonnet 5, 4/4 briefs) | cvox 11–27% fewer |
| Output tokens (Opus 5, 1 brief) | cvox 43% more — confounded, see below |
| Non-Claude model (MiMo-V2.5, OpenRouter) | cvox failed 2/2 |
| Specification size | JSON spec is 54% of the cvox spec |
| Static file size, 15 real models | cvox 19–49% smaller |

**The finding that decided it is the reasoning share.** At the scale these
models occupy, the geometry file is around 7% of what a sample costs to
generate; the rest is the model thinking about shape. A 30–50% difference in
file size therefore moves the total bill by single digits, which is not enough
to justify a bespoke parser, its tests, its grammar specification, and a barrier
to every non-Claude implementation.

Two qualitative observations survive re-reading:

- JSON versions delivered brief-specified features that cvox versions dropped —
  the ship's tapered bow, the bear's muzzle. The cvox bear was 5% air, i.e. a
  solid box with eyes.
- The three-colour palette the cvox ship declared was only 3/4 used; it never
  placed the fourth.

## What this evidence does not establish

- **n is small.** Four judged pairs, one judge, effectively two models. 4–0 has
  p = 0.125; it is suggestive, not significant. The decision does not rest on
  significance — the burden was on cvox to demonstrate the advantage it claimed,
  and it did not.
- **The Opus run is confounded.** It changed the model, removed the size
  constraints and added an animation requirement at the same time, so the cost
  reversal it shows cannot be attributed to any of them.
- **Absolute quality was poor in both arms.** The model never sees what it
  builds — one shot, no render, no revision. That is a property of the harness,
  not of either format, and it likely compresses the difference between them.

## Method notes worth keeping

- **Blind pairwise beats an absolute rubric.** The judge's stated impression was
  "no real difference"; the votes were 4–0. Small differences that both score
  "fine" on a 10-point scale still order consistently in a forced choice.
- **Briefs must name a concrete subject.** An open concept ("a creature that
  lives in a volcano") makes each arm invent a different subject, and the vote
  then compares subjects.
- **Do not constrain part counts or grid sizes.** A 10×10×10 cap made a bear
  with broad shoulders *and* a short muzzle impossible, and it held the geometry
  file down to the 7% of output where format differences cannot matter.
- **Change one variable at a time.** See the Opus run.
- **The old `bench/RESULTS.md` was measured the wrong way** and has been
  deleted. It used tiktoken — an OpenAI tokenizer — on synthetic grids built
  from `solid()`/`hollow()` fills, priced file size alone, and never measured
  quality or reasoning. If its numbers resurface from git history, they are not
  evidence.
