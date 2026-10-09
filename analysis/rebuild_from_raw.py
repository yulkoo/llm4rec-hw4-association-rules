"""Independent rebuild of the HW4 baskets from the raw UCI workbook (verification only).

Not a deliverable. It re-applies the cleaning rules listed in week4/readme.md (section 3) to
raw/Online Retail.xlsx with pandas and checks that the result equals app/transactions.js
basket by basket. Because the raw file keeps InvoiceNo and InvoiceDate, a successful match
also gives a real (not simulated) date for every basket in the starter, saved to
raw/basket_dates.json for temporal_stability.py.

Run: .venv/bin/python rebuild_from_raw.py
"""
import hashlib, json, re
from pathlib import Path
import pandas as pd

HERE = Path(__file__).parent
XLSX = HERE / "raw" / "Online Retail.xlsx"
EXPECTED_SHA = "43465a06f2ccf7c8b5bd2892bc7defb52f97487934fe93b16ae4c3936424676d"


def load_starter():
    text = (HERE.parent / "app" / "transactions.js").read_text(encoding="utf-8")
    payload = text[text.index("window.HW4 = ") + len("window.HW4 = "):].rstrip().rstrip(";")
    return json.loads(payload)


def main():
    sha = hashlib.sha256(XLSX.read_bytes()).hexdigest()
    print("sha256 matches readme:", sha == EXPECTED_SHA, sha)

    cache = HERE / "raw" / "raw.pkl"
    if cache.exists():
        df = pd.read_pickle(cache)
    else:
        df = pd.read_excel(XLSX, dtype={"InvoiceNo": str, "StockCode": str, "Description": str})
        df.to_pickle(cache)
    print("raw rows:", len(df), "| date range:", df.InvoiceDate.min(), "->", df.InvoiceDate.max())

    n0 = len(df)
    desc = df.Description.fillna("").astype(str).str.strip()
    code = df.StockCode.astype(str).str.strip().str.upper()
    keep = ~df.InvoiceNo.str[:1].isin(["C", "A"])
    keep &= desc != ""
    keep &= df.Quantity > 0
    keep &= df.UnitPrice > 0
    keep &= df.CustomerID.notna()

    # Non-product lines (postage, fees, manual entries, ...), per readme section 3.
    non_product_desc = {"POSTAGE", "DOTCOM POSTAGE", "CARRIAGE", "CRUK COMMISSION", "MANUAL", "SAMPLES", "DISCOUNT"}
    non_product_code = {"AMAZONFEE", "B", "PADS", "23444", "23574", "23595"}
    pattern = re.compile(r"^(BANK CHARGES$|TEST\d*$|GIFT_\d+)", re.I)
    non_product = desc.str.upper().isin(non_product_desc) | code.isin(non_product_code) | code.str.match(pattern)
    keep &= ~non_product

    kept = pd.DataFrame({"invoice": df.InvoiceNo[keep], "stock": code[keep], "date": df.InvoiceDate[keep]})
    pairs = kept.drop_duplicates(["invoice", "stock"])
    sizes = pairs.groupby("invoice", sort=False).stock.nunique()
    good = sizes[sizes >= 2].index
    pairs = pairs[pairs.invoice.isin(good)]
    print(f"rows {n0} -> kept (invoice, stock) pairs {len(pairs)} | baskets {pairs.invoice.nunique()} | items {pairs.stock.nunique()}")

    mine = pairs.groupby("invoice", sort=False).stock.apply(lambda s: tuple(sorted(s)))
    starter = load_starter()
    theirs = [tuple(sorted(starter["stocks"][i] for i in basket)) for basket in starter["baskets"]]
    print("starter: baskets", len(theirs), "| rows", sum(map(len, theirs)), "| items", len(starter["stocks"]))
    same_order = list(mine.values) == theirs
    print("identical basket-by-basket, in file order:", same_order)
    if not same_order:
        from collections import Counter
        a, b = Counter(mine.values), Counter(theirs)
        print("  multiset equal:", a == b, "| only mine:", sum((a - b).values()), "| only starter:", sum((b - a).values()))
        return

    first_date = kept.groupby("invoice", sort=False).date.min().loc[mine.index]
    out = [{"invoice": inv, "date": d.strftime("%Y-%m-%d")} for inv, d in first_date.items()]
    (HERE / "raw" / "basket_dates.json").write_text(json.dumps(out))
    months = first_date.dt.to_period("M").value_counts().sort_index()
    print("baskets per month:", {str(k): int(v) for k, v in months.items()})
    top = pairs.stock.value_counts().head(3)
    print("top items by basket count:", dict(top))


if __name__ == "__main__":
    main()
