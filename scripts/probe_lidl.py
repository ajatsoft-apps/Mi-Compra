from __future__ import annotations

import argparse
import json
import pathlib
import re
import time
from datetime import datetime, timezone

import requests

API_URL = "https://www.lidl.es/q/api/search"
USER_AGENT = "MiCompra-Lidl-Research/0.1 (+https://github.com/ajatsoft-apps/Mi-Compra)"
QUERIES = ("leche", "aceite de oliva", "arroz", "detergente")


def first_value(*values):
    return next((value for value in values if value not in (None, "")), None)


def parse_product(item: dict) -> dict | None:
    data = ((item.get("gridbox") or {}).get("data") or {})
    if item.get("resultClass") != "product" or not data:
        return None

    price = data.get("price") or {}
    base_price = price.get("basePrice") or {}
    packaging = price.get("packaging") or {}
    brand = data.get("brand") or {}
    category_path = ((data.get("keyfacts") or {}).get("wonCategoryPrimary") or "")
    category = category_path.rsplit("/", 1)[-1] or data.get("category")
    canonical_url = data.get("canonicalUrl")

    return {
        "product_id": str(first_value(item.get("code"), data.get("productId")) or ""),
        "name": first_value(data.get("fullTitle"), data.get("title")),
        "brand": brand.get("name") if isinstance(brand, dict) else brand,
        "price_eur": first_value(price.get("price"), price.get("amount")),
        "reference_price_eur": (base_price.get("price") if isinstance(base_price, dict) else None),
        "reference_unit": (base_price.get("unit") if isinstance(base_price, dict) else None),
        "packaging": packaging.get("text") if isinstance(packaging, dict) else None,
        "category": category,
        "ean": first_value(data.get("ean"), data.get("gtin"), data.get("barcode"),
                           item.get("ean"), item.get("gtin"), item.get("barcode")),
        "url": ("https://www.lidl.es" + canonical_url
                if isinstance(canonical_url, str) and canonical_url.startswith("/")
                else canonical_url),
        "raw_data_keys": sorted(data.keys()),
    }


def search(query: str, session: requests.Session) -> dict:
    params = {
        "assortment": "ES",
        "locale": "es_ES",
        "version": "v2.0.0",
        "q": query,
        "sort": "price",
        "offset": 0,
        "fetchsize": 40,
    }
    response = session.get(API_URL, params=params, timeout=35)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Respuesta inesperada para {query!r}: no es un objeto JSON.")
    items = payload.get("items")
    if not isinstance(items, list):
        raise RuntimeError(
            f"Respuesta de Lidl sin 'items' para {query!r}. "
            f"Claves recibidas: {sorted(payload.keys())}"
        )
    products = [product for item in items if isinstance(item, dict)
                for product in [parse_product(item)] if product]
    return {
        "query": query,
        "http_status": response.status_code,
        "reported_total": payload.get("numFound"),
        "returned_items": len(items),
        "parsed_products": len(products),
        "products": products[:12],
        "response_keys": sorted(payload.keys()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Sonda de solo lectura de la búsqueda pública de Lidl España.")
    parser.add_argument("--output", default="lidl-probe-results.json")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "es-ES,es;q=0.9",
    })

    results = []
    for index, query in enumerate(QUERIES):
        result = search(query, session)
        results.append(result)
        print(
            f"{query}: HTTP {result['http_status']} · "
            f"{result['parsed_products']} productos interpretados · "
            f"total informado={result['reported_total']}"
        )
        time.sleep(1.5)

    all_products = [product for result in results for product in result["products"]]
    summary = {
        "source": "Lidl España public web search endpoint",
        "endpoint": API_URL,
        "read_only": True,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "queries": results,
        "summary": {
            "queries_ok": len(results),
            "products_sampled": len(all_products),
            "with_price": sum(product["price_eur"] is not None for product in all_products),
            "with_reference_price": sum(product["reference_price_eur"] is not None for product in all_products),
            "with_brand": sum(bool(product["brand"]) for product in all_products),
            "with_packaging": sum(bool(product["packaging"]) for product in all_products),
            "with_ean": sum(bool(product["ean"]) for product in all_products),
            "distinct_categories": sorted({product["category"] for product in all_products if product["category"]}),
        },
    }
    output = pathlib.Path(args.output)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Resumen:", json.dumps(summary["summary"], ensure_ascii=False))
    print(f"Muestra JSON guardada en {output}")
    if not all_products:
        raise SystemExit("Lidl respondió, pero no se pudieron interpretar productos; no se considera validado.")


if __name__ == "__main__":
    main()
