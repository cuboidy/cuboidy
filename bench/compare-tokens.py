"""
Token-count comparison between CBOX (.cvox) and the equivalent JSON forms,
using real LLM tokenizers (tiktoken).

For each model `<name>` in bench/dataset/ we compare:
  <name>.cvox            — CBOX, canonical (indented)
  <name>.unindent.cvox   — CBOX, no leading indent
  <name>.min.cvox        — CBOX, all tokens on a single line
  <name>.json            — JSON nested-number arrays, pretty (2-space)
  <name>.min.json        — JSON nested-number arrays, minified
  <name>.str.json        — JSON with voxel rows as strings ("000"), pretty
  <name>.str.min.json    — JSON with voxel rows as strings, minified

Tokenized with:
  o200k_base   — GPT-4o / GPT-4.1 / o-series
  cl100k_base  — GPT-4 / GPT-3.5-turbo / Embedding v3
"""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path

import tiktoken

DATASET = Path(__file__).parent / "dataset"
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

ENCODINGS = ["o200k_base", "cl100k_base"]


def discover_models() -> list[str]:
    # Only count canonical .cvox files (skip .unindent.cvox / .min.cvox variants).
    names = sorted(
        p.stem
        for p in DATASET.glob("*.cvox")
        if not p.stem.endswith(".unindent") and not p.stem.endswith(".min")
    )
    return names


def count_tokens(enc, text: str) -> int:
    return len(enc.encode(text))


def main() -> None:
    models = discover_models()
    encoders = {name: tiktoken.get_encoding(name) for name in ENCODINGS}

    rows = []
    for m in models:
        cvox = (DATASET / f"{m}.cvox").read_text(encoding="utf-8")
        cvox_unindent = (DATASET / f"{m}.unindent.cvox").read_text(encoding="utf-8")
        cvox_min = (DATASET / f"{m}.min.cvox").read_text(encoding="utf-8")
        jpretty = (DATASET / f"{m}.json").read_text(encoding="utf-8")
        jmin = (DATASET / f"{m}.min.json").read_text(encoding="utf-8")
        jstr = (DATASET / f"{m}.str.json").read_text(encoding="utf-8")
        jstr_min = (DATASET / f"{m}.str.min.json").read_text(encoding="utf-8")

        for enc_name, enc in encoders.items():
            t_cvox = count_tokens(enc, cvox)
            t_cvox_uni = count_tokens(enc, cvox_unindent)
            t_cvox_min = count_tokens(enc, cvox_min)
            t_jpretty = count_tokens(enc, jpretty)
            t_jmin = count_tokens(enc, jmin)
            t_jstr = count_tokens(enc, jstr)
            t_jstr_min = count_tokens(enc, jstr_min)
            rows.append(
                {
                    "model": m,
                    "encoding": enc_name,
                    "cvox_tokens": t_cvox,
                    "cvox_unindent_tokens": t_cvox_uni,
                    "cvox_min_tokens": t_cvox_min,
                    "json_pretty_tokens": t_jpretty,
                    "json_min_tokens": t_jmin,
                    "json_str_tokens": t_jstr,
                    "json_str_min_tokens": t_jstr_min,
                }
            )

    # Persist CSV + JSON.
    csv_path = OUT / "token-comparison.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    (OUT / "token-comparison.json").write_text(
        json.dumps(rows, indent=2), encoding="utf-8"
    )

    # Print absolute counts per encoding.
    columns = [
        ("cvox", "cvox_tokens"),
        ("cvox-uni", "cvox_unindent_tokens"),
        ("cvox-min", "cvox_min_tokens"),
        ("json", "json_pretty_tokens"),
        ("json-min", "json_min_tokens"),
        ("str-json", "json_str_tokens"),
        ("str-min", "json_str_min_tokens"),
    ]

    for enc_name in ENCODINGS:
        print(f"\n=== {enc_name} — absolute token counts ===")
        header = f"{'model':<13}" + "".join(f"{label:>10}" for label, _ in columns)
        print(header)
        sub = [r for r in rows if r["encoding"] == enc_name]
        totals = {key: 0 for _, key in columns}
        for r in sub:
            line = f"{r['model']:<13}"
            for _, key in columns:
                line += f"{r[key]:>10}"
                totals[key] += r[key]
            print(line)
        print("-" * len(header))
        total_line = f"{'TOTAL':<13}"
        for _, key in columns:
            total_line += f"{totals[key]:>10}"
        print(total_line)

        # Reduction matrix: how much each cvox flavor saves vs each JSON flavor.
        cvox_flavors = [("cvox", "cvox_tokens"), ("cvox-uni", "cvox_unindent_tokens"), ("cvox-min", "cvox_min_tokens")]
        json_flavors = [("json", "json_pretty_tokens"), ("json-min", "json_min_tokens"), ("str-json", "json_str_tokens"), ("str-min", "json_str_min_tokens")]
        print(f"\n=== {enc_name} — total reduction (cvox flavor vs JSON flavor) ===")
        head2 = f"{'':<12}" + "".join(f"{label:>10}" for label, _ in json_flavors)
        print(head2)
        for clabel, ckey in cvox_flavors:
            row_line = f"{clabel:<12}"
            for _, jkey in json_flavors:
                pct = (1 - totals[ckey] / totals[jkey]) * 100
                sign = "" if pct < 0 else "-"  # negative reduction => cvox larger
                row_line += f"{sign}{abs(pct):>8.1f}%"
            print(row_line)

    print(f"\nWrote {csv_path}")


if __name__ == "__main__":
    main()
