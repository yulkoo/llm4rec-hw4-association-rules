"""All 380 slider positions: page (analysis/js_slider_grid.json) vs mlxtend FP-Growth. Run: .venv/bin/python slider_grid_check.py"""
import json, warnings
from pathlib import Path
import pandas as pd
from mlxtend.frequent_patterns import association_rules, fpgrowth
from mlxtend.preprocessing import TransactionEncoder
warnings.filterwarnings("ignore")
HERE = Path(__file__).parent
text = (HERE.parent / "app" / "transactions.js").read_text(encoding="utf-8")
hw4 = json.loads(text[text.index("window.HW4 = ") + 13:].rstrip().rstrip(";"))
baskets = [[hw4["stocks"][i] for i in b] for b in hw4["baskets"]]
enc = TransactionEncoder()
m = pd.DataFrame.sparse.from_spmatrix(enc.fit(baskets).transform(baskets, sparse=True), columns=enc.columns_)
grid = json.loads((HERE / "js_slider_grid.json").read_text())
bad = 0
for s in sorted({g["s"] for g in grid}):
    fp = fpgrowth(m, min_support=s / 100, use_colnames=True)
    ar = association_rules(fp, metric="confidence", min_threshold=1e-12) if len(fp) else None
    for g in (g for g in grid if g["s"] == s):
        n_rules = 0 if ar is None or not len(ar) else int((ar.confidence >= g["c"] / 100).sum())
        ok = len(fp) == g["itemsets"] and n_rules == g["rules"]
        bad += not ok
        if not ok: print("MISMATCH", g, len(fp), n_rules)
print(f"{len(grid)} slider positions compared, mismatches: {bad}")

# Explain any mismatch: are the rules the page keeps and mlxtend drops exactly ON the confidence boundary?
N = len(baskets)
js = json.loads((HERE / "js_results.json").read_text())
for s, cps in ((0.01, (20, 65)), (0.005, (20, 40, 45, 55, 65, 75, 80, 90))):
    fp = fpgrowth(m, min_support=s, use_colnames=True)
    ar = association_rules(fp, metric="confidence", min_threshold=1e-12)
    cnt = {frozenset(i): round(v * N) for i, v in zip(fp.itemsets, fp.support)}
    for cp in cps:
        on_boundary = dropped = 0
        for a, c, conf in zip(ar.antecedents, ar.consequents, ar.confidence):
            joint, ca = cnt[a | c], cnt[a]
            if joint * 100 >= cp * ca and not conf >= cp / 100:      # exact integers say keep, float says drop
                dropped += 1
                on_boundary += joint * 100 == cp * ca
                if dropped == 1: example = (joint, ca, repr(conf))
        print(f"support {s:.1%} conf {cp}%: mlxtend drops {dropped} rule(s); exactly on the boundary: {on_boundary}; e.g. joint/count(A) = {example[0]}/{example[1]}, mlxtend confidence = {example[2]}")
