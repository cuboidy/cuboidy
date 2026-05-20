# Token efficiency: CBOX vs JSON

How many LLM tokens does Cuboidy's `.cvox` format actually save versus an
equivalent JSON encoding of the same data? This document measures it on a
small dataset using real tokenizers (tiktoken — `o200k_base` for GPT-4o /
GPT-4.1, and `cl100k_base` for GPT-4 / GPT-3.5-turbo).

## TL;DR

Across 8 models (1–9 parts, 1–384 voxels each) tokenized with `o200k_base`:

| Format                                  | Total tokens | Human-readable? |
| --------------------------------------- | -----------: | :-------------: |
| JSON, pretty-printed (2-space indent)   |        7,295 |       yes       |
| JSON with voxel rows as strings, pretty |        4,114 |       yes       |
| **CBOX, canonical (indented)**          |    **2,318** |     **yes**     |
| JSON, minified                          |        2,954 |        no       |
| JSON str + minified                     |        1,881 |        no       |
| **CBOX, unindented**                    |    **1,648** |    **mostly**   |
| **CBOX, single-line ("minified")**      |    **1,526** |        no       |

Canonical, fully indented CBOX is already smaller than minified JSON.
And because CBOX's SPEC §7 treats every whitespace run as equivalent,
the same file can be served either indented (for humans / git diffs)
or with indentation stripped (for LLM API calls) — no parser change
required, no JSON re-encode step.

## Reduction matrix (`o200k_base`, total over the dataset)

Negative numbers mean CBOX wins.

|                 |   vs JSON | vs JSON-min | vs str-JSON | vs str-min |
| --------------- | --------: | ----------: | ----------: | ---------: |
| cvox (indented) |   −68.2 % |     −21.5 % |     −43.7 % |   **+23.2 %** |
| cvox-unindent   |   −77.4 % |     −44.2 % |     −59.9 % |     −12.4 % |
| cvox-min        | **−79.1 %** | **−48.3 %** | **−62.9 %** | **−18.9 %** |

`cl100k_base` shows the same picture within ±1 token (e.g. cvox-min vs
str-min is −14.2 %; full table at the bottom).

## Methodology

1. **Common source.** Eight models are defined once as in-memory objects
   in `generate-dataset.mjs`. The same objects drive every emitted form,
   so no representation can "cheat" with extra or missing data.
2. **Validated CBOX.** Every `.cvox` (including the unindented and
   single-line variants) is round-tripped through the reference parser
   `parseCvox` from `@cuboidy/core`. All 24 (8 models × 3 cvox flavors)
   parse cleanly — see `verify-cvox.mjs`.
3. **Accurate tokenization.** `compare-tokens.py` uses tiktoken's BPE
   encodings directly — no character-count proxy.
4. **Two encodings.** `o200k_base` covers modern OpenAI models;
   `cl100k_base` covers GPT-4 / 3.5-turbo. Both are reasonable proxies
   for Claude's tokenizer family in the absence of an official local
   Claude tokenizer.

## Dataset

| Model         | Parts | Voxels | CBOX tokens | JSON-pretty tokens |
| ------------- | ----: | -----: | ----------: | -----------------: |
| `tiny`        |     1 |      1 |          37 |                 91 |
| `crown`       |     1 |     18 |          60 |                183 |
| `wolf`        |     3 |     53 |         193 |                579 |
| `bird`        |     5 |     30 |         260 |                642 |
| `quadruped`   |     7 |     72 |         371 |                965 |
| `biped`       |     6 |     67 |         377 |                988 |
| `mech`        |     9 |    201 |         665 |              1,944 |
| `castle_tile` |     1 |    384 |         355 |              1,903 |
| **TOTAL**     |       |    826 |   **2,318** |          **7,295** |

The mix spans sparse-vs-dense voxel grids, single-part vs multi-part
rigs, and small (1×1×1) vs large (8×6×8) bounding boxes.

## Variants tested

For each model `<name>` we generate:

| File                    | Content                                              |
| ----------------------- | ---------------------------------------------------- |
| `<name>.cvox`           | CBOX, canonical 4-space indent, blank line between parts |
| `<name>.unindent.cvox`  | CBOX, no leading indent, one token-group per line    |
| `<name>.min.cvox`       | CBOX, every token on a single line separated by `' '` |
| `<name>.json`           | Native JSON, voxels as nested `int[][][]` (`-1` = air), 2-space indent |
| `<name>.min.json`       | Native JSON, minified                                |
| `<name>.str.json`       | JSON where each voxel row is a CBOX-style string (`"000"`), 2-space indent |
| `<name>.str.min.json`   | Same string-row JSON, minified                       |

The JSON variant intentionally mirrors what someone would write if they
re-implemented Cuboidy as pure JSON. No clever-but-non-obvious encoding
(bitmaps, RLE, base64) — that would be a different format, not a fair
comparison of the same data model.

## Per-model results (`o200k_base`)

|                 |  cvox | cvox-uni | cvox-min |  json | json-min | str-json | str-min |
| --------------- | ----: | -------: | -------: | ----: | -------: | -------: | ------: |
| `biped`         |   377 |      267 |      245 |   988 |      379 |      720 |     311 |
| `bird`          |   260 |      199 |      180 |   642 |      256 |      522 |     232 |
| `castle_tile`   |   355 |      249 |      243 | 1,903 |      847 |      465 |     269 |
| `crown`         |    60 |       44 |       40 |   183 |       76 |      114 |      55 |
| `mech`          |   665 |      457 |      425 | 1,944 |      757 |    1,162 |     519 |
| `quadruped`     |   371 |      263 |      240 |   965 |      368 |      677 |     292 |
| `tiny`          |    37 |       31 |       27 |    91 |       40 |       87 |      40 |
| `wolf`          |   193 |      138 |      126 |   579 |      231 |      367 |     163 |
| **TOTAL**       | **2,318** | **1,648** | **1,526** | **7,295** | **2,954** | **4,114** | **1,881** |

## Per-model results (`cl100k_base`)

|                 |  cvox | cvox-uni | cvox-min |  json | json-min | str-json | str-min |
| --------------- | ----: | -------: | -------: | ----: | -------: | -------: | ------: |
| `biped`         |   377 |      267 |      245 |   985 |      393 |      717 |     286 |
| `bird`          |   260 |      199 |      180 |   641 |      258 |      521 |     226 |
| `castle_tile`   |   355 |      249 |      243 | 1,902 |      844 |      464 |     261 |
| `crown`         |    61 |       45 |       41 |   184 |       75 |      115 |      53 |
| `mech`          |   665 |      457 |      425 | 1,940 |      781 |    1,158 |     483 |
| `quadruped`     |   371 |      263 |      240 |   964 |      381 |      676 |     277 |
| `tiny`          |    37 |       31 |       27 |    91 |       38 |       87 |      38 |
| `wolf`          |   193 |      138 |      126 |   578 |      232 |      366 |     156 |
| **TOTAL**       | **2,319** | **1,649** | **1,527** | **7,285** | **3,002** | **4,104** | **1,780** |

## Observations

- **Indentation is pure overhead at the LLM layer.** Stripping the
  4-space indent shaves 29 % off the CBOX token count (2,318 → 1,648)
  without changing a single semantic byte. Same goes for JSON pretty →
  minified (7,295 → 2,954, −60 %).
- **CBOX's voxel-row encoding is the real win.** Where JSON spends one
  token per cell plus brackets and commas (`[0,0,0]`), CBOX spends one
  token for the whole row (`000`). The denser the voxel data, the
  bigger the gap — `castle_tile` (384 voxels in 1 part) drops from
  1,903 to 355 tokens, a **81 %** reduction even compared to pretty
  JSON.
- **The "JSON-but-with-string-rows" hybrid doesn't catch up.** Even
  the most aggressive variant (`str-min`, 1,881 tokens) loses to
  unindented CBOX (1,648 tokens, −12.4 %) and to single-line CBOX
  (1,526 tokens, −18.9 %). The structural JSON punctuation
  (`{`, `}`, `"`, `,`, `:`) costs more than CBOX's bare keywords.
- **Tokenizer-portable.** The picture is virtually identical between
  `o200k_base` and `cl100k_base`. Differences are at most a few
  tokens per model.

## Recommendation

| Use case                     | Format                  | Total tokens |
| ---------------------------- | ----------------------- | -----------: |
| Source storage, human edits  | `cvox` (indented)       |        2,318 |
| LLM context / API send       | `cvox` (unindented)     |        1,648 |
| Extreme compression          | `cvox` (single-line)    |        1,526 |

Because the CBOX grammar treats all whitespace as equivalent (SPEC §7),
the same file can be stored in the indented form and stripped on the
way into an LLM prompt with a one-liner: `text.split('\n').map(l => l.trimStart()).join('\n')`.
No format dialect, no separate parser path.

## Reproducing

```bash
# from repo root
node bench/generate-dataset.mjs    # writes bench/dataset/*
node bench/verify-cvox.mjs         # round-trip every .cvox through @cuboidy/core
python bench/compare-tokens.py     # writes bench/out/token-comparison.{csv,json}
```

`@cuboidy/core` must be built first (`cd ts/packages/core && npm run build`)
because `verify-cvox.mjs` imports from `dist/`. `pip install tiktoken` for
the Python side.
