"""Second-pass checks (verification only). Run: .venv/bin/python recheck_extra.py
1. Counts of the two headline rules taken straight from the raw UCI workbook (not from transactions.js).
2. Null model: same item frequencies, items placed in baskets independently -> what does 'lift of a pair' look like?
"""
import json
from itertools import combinations
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
raw = pd.read_pickle(HERE / "raw" / "raw.pkl")
dates = json.loads((HERE / "raw" / "basket_dates.json").read_text())
keep_invoices = {d["invoice"] for d in dates}                      # the 17,080 invoices of the starter
rows = raw[raw.InvoiceNo.isin(keep_invoices) & (raw.Quantity > 0) & (raw.UnitPrice > 0)]
code = rows.StockCode.astype(str).str.strip().str.upper()
inv = lambda c: set(rows.InvoiceNo[code == c])
N = len(keep_invoices)
for a, b in (("22697", "22699"), ("22727", "85123A"), ("21754", "85123A"), ("22916", "22917")):
    A, B = inv(a), inv(b); j = len(A & B)
    desc = rows.Description[code == a].mode().iat[0], rows.Description[code == b].mode().iat[0]
    print(f"raw workbook: {a} {desc[0]!r} -> {b} {desc[1]!r}: joint {j}, A {len(A)}, B {len(B)}, N {N} | support {j/N:.6f} confidence {j/len(A):.6f} lift {j/len(A)/(len(B)/N):.4f}")

text = (HERE.parent / "app" / "transactions.js").read_text(encoding="utf-8")
hw4 = json.loads(text[text.index("window.HW4 = ") + 13:].rstrip().rstrip(";"))
counts = np.bincount(np.concatenate([np.array(b) for b in hw4["baskets"]]), minlength=len(hw4["stocks"]))
freq = np.nonzero(counts / N >= 0.01)[0]
rng = np.random.default_rng(42)
meds, shares = [], []
for rep in range(5):
    M = np.zeros((N, len(freq)), dtype=np.float32)
    for col, item in enumerate(freq):
        M[rng.choice(N, size=counts[item], replace=False), col] = 1          # independent placement, same frequency
    joint = M.T @ M
    iu = np.triu_indices(len(freq), 1)
    lift = joint[iu] * N / (counts[freq][iu[0]] * counts[freq][iu[1]])
    meds.append(float(np.median(lift))); shares.append(float((lift > 1).mean()))
print(f"null model (independent items, same frequencies, {len(freq)} items, {len(iu[0])} pairs, 5 draws): median lift {np.mean(meds):.3f} (range {min(meds):.3f}-{max(meds):.3f}), share with lift > 1: {np.mean(shares):.3f}")
