"""Audit of the provided dataset (app/transactions.js) against the raw UCI workbook. Verification only.
Run: .venv/bin/python audit_data.py"""
import json, re
from collections import Counter, defaultdict
from pathlib import Path
import pandas as pd

HERE = Path(__file__).parent
text = (HERE.parent / "app" / "transactions.js").read_text(encoding="utf-8")
hw4 = json.loads(text[text.index("window.HW4 = ") + 13:].rstrip().rstrip(";"))
stocks, descs, baskets = hw4["stocks"], hw4["descriptions"], hw4["baskets"]
print("keys:", list(hw4)); print("provenance:", hw4["dataset_provenance"])
print("N_BASKETS", hw4["N_BASKETS"], "len(baskets)", len(baskets), "| N_ITEMS", hw4["N_ITEMS"], "len(stocks)", len(stocks), "len(descriptions)", len(descs))
print("index range ok:", all(0 <= i < len(stocks) for b in baskets for i in b), "| used item ids:", len({i for b in baskets for i in b}))
print("baskets with repeated item:", sum(len(set(b)) != len(b) for b in baskets), "| baskets with <2 items:", sum(len(b) < 2 for b in baskets))
print("duplicate stock codes:", len(stocks) - len(set(stocks)), "| case-insensitive duplicates:", len(stocks) - len({s.upper().strip() for s in stocks}),
      "| codes with lower case / spaces:", [s for s in stocks if s != s.upper().strip()][:10])
by_desc = defaultdict(list)
for s, d in zip(stocks, descs): by_desc[d].append(s)
shared = {d: c for d, c in by_desc.items() if len(c) > 1}
print("descriptions shared by >1 stock code:", len(shared), "(", sum(map(len, shared.values())), "codes )")
odd = [(s, d) for s, d in zip(stocks, descs) if not re.fullmatch(r"\d{5}[A-Z]{0,2}", s)]
print("codes not of the form 5 digits + up to 2 letters:", len(odd), odd)
suspect = [(s, d) for s, d in zip(stocks, descs) if re.search(r"POSTAGE|CARRIAGE|CHARGE|FEE|MANUAL|DISCOUNT|SAMPLE|ADJUST|COMMISSION|VOUCHER|\?|DAMAGE|LOST|CHECK|FOUND|WRONG|TEST", d)]
print("descriptions that look like non-products:", suspect)
count = Counter(i for b in baskets for i in b)
print("items ordered by descending basket count (as the generator states):", all(count[i] >= count[i + 1] for i in range(len(stocks) - 1)))

raw = pd.read_pickle(HERE / "raw" / "raw.pkl")
print("\nraw rows", len(raw))
code = raw.StockCode.astype(str).str.strip().str.upper()
d = raw.Description.fillna("").astype(str)
norm = d.map(lambda x: (" ".join(x.split()).upper().rstrip(".,;:!?").strip()) or " ".join(x.split()).upper())
dates = json.loads((HERE / "raw" / "basket_dates.json").read_text())
keep = {x["invoice"] for x in dates}
rows = raw.InvoiceNo.isin(keep) & (raw.Quantity > 0) & (raw.UnitPrice > 0) & raw.CustomerID.notna() & (d.str.strip() != "")
# Label check: is descriptions[i] really the (most frequent) raw description of stocks[i]?
tab = pd.DataFrame({"code": code[rows], "desc": norm[rows]})
freq = tab.groupby("code").desc.agg(lambda s: sorted(Counter(s).items(), key=lambda kv: (-kv[1], kv[0]))[0][0])
allv = tab.groupby("code").desc.agg(lambda s: set(s))
mism = [(s, dd, freq.get(s)) for s, dd in zip(stocks, descs) if freq.get(s) != dd]
never = [(s, dd) for s, dd in zip(stocks, descs) if dd not in allv.get(s, set())]
print("labels: description != most frequent raw description for", len(mism), "codes; description never used for that code in raw:", len(never), never[:5])
multi = allv[allv.map(len) > 1]
print("codes with more than one distinct raw description:", len(multi), "| examples:", [(k, sorted(v)) for k, v in list(multi.items())[:3]])

# One invoice = one transaction? customers / dates per invoice
g = raw[raw.InvoiceNo.isin(keep)].groupby("InvoiceNo")
print("\ninvoices with >1 CustomerID:", int((g.CustomerID.nunique() > 1).sum()), "| with >1 calendar date:", int((g.InvoiceDate.agg(lambda s: s.dt.date.nunique()) > 1).sum()),
      "| with >1 timestamp:", int((g.InvoiceDate.nunique() > 1).sum()), "| with >1 country:", int((g.Country.nunique() > 1).sum()))
# What each README filter removes, applied in the generator's order
n = len(raw); m = pd.Series(True, index=raw.index); steps = []
def step(name, cond):
    global m
    drop = m & cond; steps.append((name, int(drop.sum()))); m = m & ~cond
step("cancellation/adjustment invoice (C/A)", raw.InvoiceNo.str[:1].isin(["C", "A"]))
step("blank description", d.str.strip() == "")
step("quantity <= 0", raw.Quantity <= 0)
step("unit price <= 0", raw.UnitPrice <= 0)
step("blank CustomerID (guest checkout)", raw.CustomerID.isna())
np_desc = {"POSTAGE", "DOTCOM POSTAGE", "CARRIAGE", "CRUK COMMISSION", "MANUAL", "SAMPLES", "DISCOUNT"}
step("non-product line", d.str.strip().str.upper().isin(np_desc) | code.isin({"AMAZONFEE", "B", "PADS", "23444", "23574", "23595"}) | code.str.match(r"^(BANK CHARGES$|TEST\d*$|GIFT_\d+)", case=False))
print("filters, in order:", steps, "| rows left", int(m.sum()))
left = pd.DataFrame({"inv": raw.InvoiceNo[m], "code": code[m]}).drop_duplicates()
sz = left.groupby("inv").code.nunique()
print("distinct (invoice, item) pairs:", len(left), "| invoices:", len(sz), "| single-item invoices dropped:", int((sz < 2).sum()), "| pairs kept:", int(sz[sz >= 2].sum()))
guest = raw[raw.CustomerID.isna() & ~raw.InvoiceNo.str[:1].isin(["C", "A"]) & (raw.Quantity > 0) & (raw.UnitPrice > 0)]
print("guest-checkout invoices removed:", guest.InvoiceNo.nunique(), "rows", len(guest))
# identical baskets
sets = Counter(frozenset(b) for b in baskets)
print("baskets whose item set is repeated elsewhere:", sum(v for v in sets.values() if v > 1), "| distinct repeated sets:", sum(1 for v in sets.values() if v > 1))
