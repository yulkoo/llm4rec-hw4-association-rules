"""Numbers for the HW4 report, sections IV-V (analysis only; not a deliverable).

Part 1 uses only app/transactions.js (the starter data).
Part 2 uses dates and customer ids from the raw UCI workbook; it needs raw/basket_dates.json
and raw/raw.pkl written by rebuild_from_raw.py. Nothing is simulated.

Run: .venv/bin/python analysis.py   -> analysis_results.json
"""
import json
from collections import Counter
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
text = (HERE.parent / "app" / "transactions.js").read_text(encoding="utf-8")
hw4 = json.loads(text[text.index("window.HW4 = ") + 13:].rstrip().rstrip(";"))
name = dict(zip(hw4["stocks"], hw4["descriptions"]))
baskets = [frozenset(hw4["stocks"][i] for i in b) for b in hw4["baskets"]]
N = len(baskets)
js = json.loads((HERE / "js_results.json").read_text())
R = {}

tids = {}
for t, b in enumerate(baskets):
    for i in b:
        tids.setdefault(i, set()).add(t)
size = np.array([len(b) for b in baskets])


def cover(items):
    return set.intersection(*(tids[i] for i in items))


def metrics(a, b, subset=None):
    """Counts and metrics of A -> B, optionally inside a subset of basket ids."""
    ta, tb = cover(a), cover(b)
    n = N
    if subset is not None:
        ta, tb, n = ta & subset, tb & subset, len(subset)
    joint = len(ta & tb)
    conf = joint / len(ta) if ta else float("nan")
    lift = conf / (len(tb) / n) if tb and ta else float("nan")
    return dict(joint=joint, countA=len(ta), countB=len(tb), n=n, support=joint / n, confidence=conf, lift=lift)


BINS = [(2, 5), (6, 10), (11, 20), (21, 40), (41, 80), (81, 10**6)]
strata = [set(np.nonzero((size >= lo) & (size <= hi))[0].tolist()) for lo, hi in BINS]


def size_adjusted(a, b):
    """Lift after holding basket size fixed: observed joint count / sum of per-stratum expected counts."""
    rows, expected, joint = [], 0.0, 0
    for (lo, hi), s in zip(BINS, strata):
        m = metrics(a, b, s)
        e = m["countA"] * m["countB"] / m["n"]
        expected += e
        joint += m["joint"]
        rows.append(dict(bin=f"{lo}-{hi if hi < 10**6 else 'max'}", n=m["n"], countA=m["countA"], countB=m["countB"], joint=m["joint"], expected=round(e, 2), lift=None if not m["joint"] or not e else round(m["joint"] / e, 3)))
    return dict(strata=rows, expected=round(expected, 2), adjusted_lift=round(joint / expected, 3))


def show(tag, a, b):
    m, r = metrics(a, b), metrics(b, a)
    adj = size_adjusted(a, b)
    R[tag] = dict(a=a, b=b, a_name=[name[i] for i in a], b_name=[name[i] for i in b], forward=m, reverse=r, size_adjusted=adj,
                  expected_if_independent=round(m["countA"] * m["countB"] / N, 2))
    print(f"\n[{tag}] {' + '.join(i + ' ' + name[i] for i in a)}  ->  {' + '.join(i + ' ' + name[i] for i in b)}")
    print(f"  count(AuB)={m['joint']} count(A)={m['countA']} count(B)={m['countB']} N={N}")
    print(f"  support={m['support']:.4%} confidence={m['confidence']:.4%} lift={m['lift']:.4f} | reverse confidence={r['confidence']:.4%} lift={r['lift']:.4f}")
    print(f"  expected joint if independent={m['countA'] * m['countB'] / N:.1f} | size-adjusted lift={adj['adjusted_lift']} (expected {adj['expected']})")
    for row in adj["strata"]:
        print("   ", row)


# ---- Part 1: starter data only ------------------------------------------------------------
print("basket size: median", int(np.median(size)), "mean", round(size.mean(), 2), "max", int(size.max()),
      "| share of baskets with >40 items:", round(float((size > 40).mean()), 4))
R["basket_size"] = dict(median=int(np.median(size)), mean=round(float(size.mean()), 2), max=int(size.max()),
                        p90=int(np.percentile(size, 90)), strata=[dict(bin=f"{lo}-{hi}", n=len(s)) for (lo, hi), s in zip(BINS, strata)])
top = sorted(tids, key=lambda i: -len(tids[i]))[:3]
R["top_items"] = [dict(stock=i, name=name[i], count=len(tids[i]), share=len(tids[i]) / N) for i in top]
print("top items:", R["top_items"])

show("useful", ["22697"], ["22699"])
show("misleading", ["21754"], ["85123A"])
show("herb", ["22916"], ["22917"])
show("party", ["21080", "21086"], ["21094"])

# Rules with lift <= 1 that still pass a 10% confidence threshold (support >= 0.5%).
low = sorted((r for r in js["settings"]["0.005|0.1"]["rules"] if r["lift"] <= 1.0), key=lambda r: r["lift"])
R["lift_below_1"] = low
for r in low:
    print("lift<=1:", r["a"], [name[i] for i in r["a"]], "->", r["b"], [name[i] for i in r["b"]], r["joint"], r["ca"], r["cb"], f"conf {r['confidence']:.4%} lift {r['lift']:.4f}")
    show("below1_" + r["a"][0], r["a"], r["b"])

# All pairs, no support threshold: the high-lift / tiny-count trap.
item_count = {i: len(t) for i, t in tids.items()}
pair_count = Counter(p for b in baskets for p in combinations(sorted(b), 2))
lifts = {p: c * N / (item_count[p[0]] * item_count[p[1]]) for p, c in pair_count.items()}
best = max(lifts, key=lambda p: (lifts[p], pair_count[p]))
R["tiny_count_trap"] = dict(pair=best, names=[name[i] for i in best], joint=pair_count[best], counts=[item_count[i] for i in best], lift=lifts[best],
                            pairs_lift_over_100=sum(1 for p in lifts if lifts[p] > 100),
                            of_which_joint_below_10=sum(1 for p in lifts if lifts[p] > 100 and pair_count[p] < 10),
                            distinct_pairs=len(pair_count))
print("\ntiny-count trap:", R["tiny_count_trap"])

# How common is lift > 1 among pairs of frequent items? (support >= 1% items, all 238,395 pairs)
freq_items = sorted(i for i, c in item_count.items() if c / N >= 0.01)
pl = np.array([pair_count.get(p, 0) * N / (item_count[p[0]] * item_count[p[1]]) for p in combinations(freq_items, 2)])
R["pairs_of_frequent_items"] = dict(items=len(freq_items), pairs=len(pl), share_lift_above_1=float((pl > 1).mean()), median_lift=float(np.median(pl)), mean_lift=float(pl.mean()))
print("pairs of frequent items:", R["pairs_of_frequent_items"])

# Apriori bookkeeping at 1% support: candidates per level with and without the prune step.
level_sets = {}
for s in js["settings"]["0.01|0.3"]["itemsets"]:
    level_sets.setdefault(len(s["items"]), set()).add(tuple(s["items"]))
book = [dict(k=1, possible=len(tids), frequent=len(level_sets[1]))]
k = 2
while k - 1 in level_sets:
    prev = sorted(level_sets[k - 1])
    joined = [a + (b[-1],) for a, b in combinations(prev, 2) if a[:-1] == b[:-1]]
    pruned = [c for c in joined if all(c[:d] + c[d + 1:] in level_sets[k - 1] for d in range(k))]
    from math import comb
    book.append(dict(k=k, possible=comb(len(tids), k), joined=len(joined), after_prune=len(pruned), frequent=len(level_sets.get(k, ()))))
    k += 1
R["apriori_levels_1pct"] = book
print("apriori levels @1%:", book)

# Size-adjusted lift for every rule of the final table (pairs only, to keep it simple).
final = js["settings"]["0.01|0.3"]["rules"]
pair_rules = [r for r in final if len(r["a"]) == 1 and len(r["b"]) == 1]
adj = [size_adjusted(r["a"], r["b"])["adjusted_lift"] for r in pair_rules]
ratio = np.array(adj) / np.array([r["lift"] for r in pair_rules])
R["final_table"] = dict(rules=len(final), pair_rules=len(pair_rules), unordered_pairs=len({frozenset(r["a"] + r["b"]) for r in pair_rules}),
                        raw_lift_min=min(r["lift"] for r in final), raw_lift_median=float(np.median([r["lift"] for r in final])),
                        adj_over_raw_median=float(np.median(ratio)), adj_lift_min=float(min(adj)), adj_lift_below_2=int(sum(a < 2 for a in adj)))
print("final table:", R["final_table"])

# ---- Part 2: real dates and customers from the raw UCI workbook ---------------------------
dates_file = HERE / "raw" / "basket_dates.json"
if dates_file.exists():
    meta = pd.DataFrame(json.loads(dates_file.read_text()))
    meta["date"] = pd.to_datetime(meta.date)
    raw = pd.read_pickle(HERE / "raw" / "raw.pkl")
    cust = raw.dropna(subset=["CustomerID"]).drop_duplicates("InvoiceNo").set_index("InvoiceNo")
    meta["customer"] = cust.CustomerID.reindex(meta.invoice).astype(int).values
    meta["country"] = cust.Country.reindex(meta.invoice).values
    R["customers"] = dict(distinct=int(meta.customer.nunique()), uk_basket_share=float((meta.country == "United Kingdom").mean()))
    print("\ncustomers:", R["customers"])

    def by_period(tag, a, b):
        rows = []
        for label, lo, hi in [("2010-12..2011-05", "2010-12-01", "2011-05-31"), ("2011-06..2011-12", "2011-06-01", "2011-12-31"),
                              ("Q1 Dec-Feb", "2010-12-01", "2011-02-28"), ("Q2 Mar-May", "2011-03-01", "2011-05-31"),
                              ("Q3 Jun-Aug", "2011-06-01", "2011-08-31"), ("Q4 Sep-Dec9", "2011-09-01", "2011-12-31")]:
            s = set(np.nonzero(((meta.date >= lo) & (meta.date <= hi)).values)[0].tolist())
            m = metrics(a, b, s)
            rows.append(dict(period=label, **{k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}))
            print(f"  [{tag}] {label:18s} N={m['n']:5d} joint={m['joint']:4d} A={m['countA']:4d} B={m['countB']:4d} sup={m['support']:.2%} conf={m['confidence']:.2%} lift={m['lift']:.2f}")
        joint_ids = sorted(cover(a) & cover(b))
        c = meta.customer.iloc[joint_ids].value_counts()
        a_c = meta.customer.iloc[sorted(cover(a))].nunique()
        R[tag]["periods"] = rows
        R[tag]["customers"] = dict(joint_baskets=len(joint_ids), distinct_customers=int(len(c)), top_customer_baskets=int(c.iloc[0]), top5_baskets=int(c.head(5).sum()),
                                   customers_with_1_basket=int((c == 1).sum()), antecedent_customers=int(a_c))
        print(f"  [{tag}] customers behind the joint baskets:", R[tag]["customers"])

    by_period("useful", ["22697"], ["22699"])
    by_period("misleading", ["21754"], ["85123A"])

    # Hold-out: do the rules mined on the first period survive in the later one?
    early = set(np.nonzero((meta.date <= "2011-08-31").values)[0].tolist())
    late = set(range(N)) - early
    survived, lifts_e, lifts_l, n_rules = 0, [], [], 0
    for r in final:
        e, l = metrics(r["a"], r["b"], early), metrics(r["a"], r["b"], late)
        if e["support"] >= 0.01 and e["confidence"] >= 0.3:
            n_rules += 1
            lifts_e.append(e["lift"]); lifts_l.append(l["lift"] if l["countA"] else 0.0)
            survived += int(l["support"] >= 0.01 and l["confidence"] >= 0.3)
    rho = float(pd.Series(lifts_e).corr(pd.Series(lifts_l), method="spearman"))
    R["holdout"] = dict(early_baskets=len(early), late_baskets=len(late), rules_passing_early=n_rules, still_passing_late=survived,
                        share=survived / n_rules, spearman_lift=rho, late_lift_above_1=int(sum(x > 1 for x in lifts_l)))
    print("hold-out:", R["holdout"])
else:
    print("\n(raw/basket_dates.json not found: Part 2 skipped)")

(HERE / "analysis_results.json").write_text(json.dumps(R, indent=1, default=lambda o: o.item() if hasattr(o, "item") else list(o)))
