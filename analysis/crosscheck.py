"""Cross-check of the page's miner against two independent implementations (verification only).

1. mlxtend FP-Growth + association_rules (a different algorithm and a different code base).
2. A brute-force pair counter (itertools.combinations over every basket), no pruning at all.

Reads analysis/js_results.json written by `node tests/export_results.js`.
Run: .venv/bin/python crosscheck.py
"""
import json
from collections import Counter
from itertools import combinations
from pathlib import Path

import pandas as pd
from mlxtend.frequent_patterns import association_rules, fpgrowth
from mlxtend.preprocessing import TransactionEncoder

HERE = Path(__file__).parent
text = (HERE.parent / "app" / "transactions.js").read_text(encoding="utf-8")
hw4 = json.loads(text[text.index("window.HW4 = ") + 13:].rstrip().rstrip(";"))
baskets = [[hw4["stocks"][i] for i in b] for b in hw4["baskets"]]
N = len(baskets)
js = json.loads((HERE / "js_results.json").read_text())

encoder = TransactionEncoder()
matrix = pd.DataFrame.sparse.from_spmatrix(encoder.fit(baskets).transform(baskets, sparse=True), columns=encoder.columns_)
print(f"basket matrix: {matrix.shape[0]} invoices x {matrix.shape[1]} items, {int(matrix.sparse.density * matrix.size)} ones")

# Brute force: every item and every pair in every basket.
item_count = Counter(i for b in baskets for i in set(b))
pair_count = Counter(p for b in baskets for p in combinations(sorted(set(b)), 2))
print(f"brute force: {len(item_count)} items, {len(pair_count)} distinct co-occurring pairs")

for key, result in js["settings"].items():
    min_support, min_conf = map(float, key.split("|"))
    mine = {tuple(s["items"]): s["count"] for s in result["itemsets"]}

    fp = fpgrowth(matrix, min_support=min_support, use_colnames=True)
    theirs = {tuple(sorted(s)): round(sup * N) for s, sup in zip(fp.itemsets, fp.support)}
    same_sets = mine == theirs

    brute = {(i,): c for i, c in item_count.items() if c / N >= min_support}
    brute.update({p: c for p, c in pair_count.items() if c / N >= min_support})
    mine_12 = {k: v for k, v in mine.items() if len(k) <= 2}
    same_brute = mine_12 == brute

    ar = association_rules(fp, metric="confidence", min_threshold=min_conf)
    ref = {(tuple(sorted(a)), tuple(sorted(c))): (s, cf, l) for a, c, s, cf, l in zip(ar.antecedents, ar.consequents, ar.support, ar.confidence, ar.lift)}
    got = {(tuple(sorted(r["a"])), tuple(sorted(r["b"]))): (r["support"], r["confidence"], r["lift"]) for r in result["rules"]}
    max_diff = max((abs(x - y) for k in got if k in ref for x, y in zip(got[k], ref[k])), default=0.0)
    print(f"support>={min_support:<6} conf>={min_conf:<4} | itemsets JS {len(mine):5d} / FP-Growth {len(theirs):5d} identical(sets+counts): {same_sets}"
          f" | 1-2-itemsets vs brute force ({len(brute)}): {same_brute}"
          f" | rules JS {len(got):5d} / mlxtend {len(ref):5d} same keys: {set(got) == set(ref)} max|diff| {max_diff:.2e}")
