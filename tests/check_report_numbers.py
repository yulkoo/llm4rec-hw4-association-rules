"""Checks that the numbers printed in report/report.html are the ones in the saved outputs.
Every expected string is formatted here from the result files, not typed by hand. Run: python3 tests/check_report_numbers.py"""
import html, json, re
from pathlib import Path
ROOT = Path(__file__).parent.parent
text = (ROOT / "report" / "report.html").read_text(encoding="utf-8")
text = re.sub(r"</t[dh]>", " ", text)
text = html.unescape(re.sub(r"<[^>]+>", "", text)).replace(" ", " ")
text = re.sub(r"\s+", " ", text)
R = json.loads((ROOT / "analysis" / "analysis_results.json").read_text())
J = json.loads((ROOT / "analysis" / "js_results.json").read_text())
G = json.loads((ROOT / "analysis" / "js_slider_grid.json").read_text())
ok = bad = 0
def need(label, *strings):
    global ok, bad
    for st in strings:
        if st in text: ok += 1
        else: bad += 1; print(f"MISSING [{label}]: {st!r}")
c = lambda n: f"{n:,}"
pct = lambda x, d=2: f"{x * 100:.{d}f}%"

for tag in ("useful", "misleading", "herb"):
    f, r, adj = R[tag]["forward"], R[tag]["reverse"], R[tag]["size_adjusted"]["adjusted_lift"]
    need(tag, c(f["joint"]), c(f["countA"]), c(f["countB"]), pct(f["support"]), pct(f["confidence"]), f"{f['lift']:.2f}", f"{adj:.2f}")
u = R["useful"]; f = u["forward"]; r = u["reverse"]
need("useful text", pct(r["confidence"]), f"{f['lift']:.4f}", f"{f['support']:.6f}", f"{f['confidence']:.6f}", f"{r['confidence']:.6f}", f"{f['countB'] / f['n']:.6f}",
     f"= {u['expected_if_independent']:.1f} joint", f"{f['countA'] - f['joint']} baskets that had Green", f"the {f['countB'] - f['joint']} with Roses",
     f"{u['customers']['distinct_customers']} customers", f"accounts for {u['customers']['top_customer_baskets']} of them")
s = u["size_adjusted"]["strata"]; need("useful strata", f"from {s[0]['lift']:.0f} in the smallest baskets to {s[-1]['lift']:.1f} in the largest")
b = R["below1_22727"]; f = b["forward"]
need("reject", c(f["joint"]), c(f["countA"]), pct(f["support"]), pct(f["confidence"]), f"{f['lift']:.2f}", f"{b['size_adjusted']['adjusted_lift']:.2f}", f"= {b['expected_if_independent']:.1f} and the observed count is {f['joint']}")
m = R["misleading"]; need("weak", pct(m["reverse"]["confidence"]), f"size-adjusted lift is {m['size_adjusted']['adjusted_lift']:.2f}",
     f"support is {pct(m['periods'][5]['support'])} and its confidence {pct(m['periods'][5]['confidence'], 1)}")
h = R["herb"]["forward"]; need("herb", f"only {h['countA'] - h['joint']} of {h['countA']} antecedent baskets", f"({h['lift']:.1f})")
t = R["tiny_count_trap"]; need("trap", f"{c(t['pairs_lift_over_100'])} pairs have lift above 100", f"{c(t['of_which_joint_below_10'])} of them ({t['of_which_joint_below_10'] / t['pairs_lift_over_100']:.0%})",
     f"the maximum, {c(int(t['lift']))}", f"{c(t['distinct_pairs'])} distinct pairs")
q = R["pairs_of_frequent_items"]; need("pairs", f"all {c(q['pairs'])} pairs of the {q['items']} frequent items, {q['share_lift_above_1']:.1%} have lift > 1 and the median lift is {q['median_lift']:.2f}")
ft = R["final_table"]; need("final", f"the {ft['pair_rules']} single-item rules", f"a median {ft['adj_over_raw_median']:.2f} of the raw one", f"every one of them has lift ≥ {ft['raw_lift_min']:.2f}")
lv = R["apriori_levels_1pct"]
need("apriori", f"{lv[0]['frequent']} frequent items give {c(lv[1]['joined'])} candidate pairs (of {lv[1]['possible'] / 1e6:.2f} million possible), {lv[1]['frequent']} are frequent",
     f"gives {c(lv[2]['joined'])} triples, the prune step leaves {lv[2]['after_prune']}, and {lv[2]['frequent']} are frequent", f"{lv[3]['joined']} → {lv[3]['after_prune']} → {lv[3]['frequent']} at level 4")
ho = R["holdout"]; need("holdout", f"Of the {ft['rules']} rules, {ho['rules_passing_early']} also pass", f"only {ho['still_passing_late']} of those ({ho['share']:.1%})", f"all {ho['late_lift_above_1']} keep lift > 1", f"Spearman {ho['spearman_lift']:.2f}")
for row, label in zip(u["periods"][2:], ("Dec 2010 – Feb 2011", "Mar – May 2011", "Jun – Aug 2011", "Sep – 9 Dec 2011")):
    need("Table III " + label, f"{label} {c(row['n'])} {row['joint']} {row['countA']} {pct(row['support'])} {pct(row['confidence'], 1)} {row['lift']:.1f}")
bs = R["basket_size"]; need("basket size", f"median {bs['median']}, mean {bs['mean']:.1f}, maximum {bs['max']}")
need("top item", f"{c(R['top_items'][0]['count'])} baskets, {pct(R['top_items'][0]['share'])}")
# Table II from the sweep, plus the lowest-lift row.
sw = {(x["minSupport"], x["minConfidence"]): x for x in J["sweep"]}
for ms, label in ((0.005, "0.5% (86)"), (0.01, "1% (171)"), (0.02, "2% (342)"), (0.03, "3% (513)"), (0.05, "5% (854)")):
    x = sw[(ms, 0.1)]; by = x["bySize"]; four = sum(v for k, v in by.items() if int(k) >= 4)
    sizes = "/".join(c(by.get(str(k), 0)) for k in (1, 2, 3)) + "/" + c(four)
    need("Table II " + label, f"{label} {c(x['itemsets'])} ({sizes}) " + " ".join(c(sw[(ms, mc)]["rules"]) for mc in (0.1, 0.3, 0.6, 0.8)))
    assert -(-ms * 17080 // 1) == int(label.split("(")[1].rstrip(")")), label
need("lowest lift", "Lowest lift at 1% – " + " ".join(f"{sw[(0.01, mc)]['minLift']:.2f}" for mc in (0.1, 0.3, 0.6, 0.8)))
g = {(x["s"], x["c"]): x for x in G}
need("grid", f"{c(g[(0.5, 10)]['rules'])} rules", "all 380 slider positions")
assert len(G) == 380 and sum(x["liftLE1"] for x in G) == 2 and g[(0.5, 10)]["liftLE1"] == 2
assert sum(1 for x in J["settings"]["0.01|0.3"]["rules"] if x["lift"] > 1) == 950
print(f"{ok} strings found, {bad} missing")
