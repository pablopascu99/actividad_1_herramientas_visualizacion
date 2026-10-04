"""Limpia las transacciones de Online Retail II y las exporta a CSV."""

from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "datos"
START = pd.Timestamp("2010-12-01")
END = pd.Timestamp("2011-12-01")


def clean_transactions(frame):
    source_rows = len(frame)
    duplicate_rows = int(frame.duplicated().sum())
    frame = frame.drop_duplicates().rename(columns={
        "Invoice": "invoice",
        "StockCode": "stock",
        "Description": "description",
        "Quantity": "quantity",
        "InvoiceDate": "date",
        "Price": "price",
        "Customer ID": "customer",
        "Country": "country",
    }).copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["stock"] = frame["stock"].astype("string").str.strip()
    frame["invoice"] = frame["invoice"].astype("string").str.strip()
    frame["quantity"] = pd.to_numeric(frame["quantity"], errors="coerce")
    frame["price"] = pd.to_numeric(frame["price"], errors="coerce")
    frame["customer"] = pd.to_numeric(frame["customer"], errors="coerce").astype("Int64")

    period = frame.loc[frame["date"].ge(START) & frame["date"].lt(END)].copy()
    merchandise = period["stock"].str.match(r"^\d", na=False)
    valid_price = period["price"].gt(0)
    valid_quantity = period["quantity"].ne(0) & period["quantity"].notna()
    cancelled = period["invoice"].str.upper().str.startswith("C", na=False)
    sale = period["quantity"].gt(0) & ~cancelled
    returned = period["quantity"].lt(0)
    clean = period.loc[merchandise & valid_price & valid_quantity & (sale | returned)].copy()
    clean["amount"] = (clean["quantity"] * clean["price"]).round(2)
    clean["transaction_type"] = clean["quantity"].gt(0).map({True: "sale", False: "return"})
    clean = clean[[
        "date", "invoice", "stock", "description", "quantity", "price",
        "amount", "customer", "country", "transaction_type",
    ]].sort_values(["date", "invoice", "stock"], kind="stable")

    audit = {
        "source_rows": source_rows,
        "duplicate_rows_removed": duplicate_rows,
        "rows_retained": len(clean),
        "sales": int(clean["transaction_type"].eq("sale").sum()),
        "returns": int(clean["transaction_type"].eq("return").sum()),
        "anonymous_customers": int(clean["customer"].isna().sum()),
        "sales_amount": round(float(clean.loc[clean["transaction_type"].eq("sale"), "amount"].sum()), 2),
        "returns_amount": round(float(clean.loc[clean["transaction_type"].eq("return"), "amount"].sum()), 2),
    }
    return clean, audit


def main():
    OUT.mkdir(exist_ok=True)
    source = pd.read_excel(ROOT / "online_retail_II.xlsx", sheet_name="Year 2010-2011")
    clean, audit = clean_transactions(source)
    output = OUT / "transacciones_limpias.csv"
    clean.to_csv(output, index=False, encoding="utf-8-sig", date_format="%Y-%m-%d %H:%M:%S")

    assert clean["date"].ge(START).all() and clean["date"].lt(END).all()
    assert clean["amount"].equals((clean["quantity"] * clean["price"]).round(2))
    assert clean.loc[clean["transaction_type"].eq("sale"), "quantity"].gt(0).all()
    assert clean.loc[clean["transaction_type"].eq("return"), "quantity"].lt(0).all()
    print(f"CSV generado: {output.relative_to(ROOT)}")
    for name, value in audit.items():
        print(f"{name}: {value}")


if __name__ == "__main__":
    main()