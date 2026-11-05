#!/usr/bin/env python3
"""Read-only probe of Lidl Spain's public storefront search API.

No login, cookies, tokens, proxies, browser impersonation or anti-bot bypass.
The endpoint is an observed storefront interface, not an official developer API.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_URL = "https://www.lidl.es/q/api/search"
OUTPUT = Path("lidl-catalog-probe.json")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)


def first_value(*values: Any) -> Any:
    return next((value for value in values if value not in (None, "")), None)


def parse_product(item: dict[str, Any]) -> dict[str, Any] | None:
    data = ((item.get("gridbox") or {}).get("data") or {})
    if item.get("resultClass") != "product" or not isinstance(data, dict):
        return None

    price = data.get("price") or {}
    base_price = price.get("basePrice") or {}
    packaging = price.get("packaging") or {}
    brand = data.get("brand") or {}
    keyfacts = data.get("keyfacts") or {}
    category_path = keyfacts.get("wonCategoryPrimary") or ""
    canonical_url = data.get("canonicalUrl")
    product_id = first_value(item.get("code"), data.get("productId"), data.get("erpNumber"))

    return {
        "product_id": str(product_id) if product_id is not None else None,
        "name": first_value(data.get("fullTitle"), data.get("title")),
        "brand": brand.get("name") if isinstance(brand, dict) else brand,
        "price_eur": first_value(price.get("price"), price.get("amount")),
        "raw_price": price,
        "raw_gs1_attributes": data.get("gs1Attributes"),
        "raw_ians": data.get("ians"),
        "raw_product_type": data.get("productType"),
        "raw_stock_availability": data.get("stockAvailability"),
        "raw_regions_prices": data.get("regionsPrices"),
        "reference_price_eur": base_price.get("price") if isinstance(base_price, dict) else None,
        "reference_unit": first_value(
            base_price.get("unit") if isinstance(base_price, dict) else None,
            base_price.get("text") if isinstance(base_price, dict) else None,
        ),
        "packaging": packaging.get("text") if isinstance(packaging, dict) else None,
        "category": category_path.rsplit("/", 1)[-1] if category_path else data.get("category"),
        "ean": first_value(
            data.get("ean"), data.get("gtin"), data.get("barcode"),
            item.get("ean"), item.get("gtin"), item.get("barcode"),
        ),
        "image_url": data.get("image"),
        "url": (
            "https://www.lidl.es" + canonical_url
            if isinstance(canonical_url, str) and canonical_url.startswith("/")
            else canonical_url
        ),
        "raw_data_keys": sorted(data.keys()),
    }


def fetch(query: str, sort: str | None, offset: int = 0) -> dict[str, Any]:
    params = {
        "assortment": "ES",
        "locale": "es_ES",
        "version": "2.0",
        "q": query,
        "offset": str(offset),
        "fetchsize": "100",
    }
    if sort:
        params["sort"] = sort
    url = API_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "*/*",
            "Accept-Language": "es-ES,es;q=0.9",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Unexpected HTTP {response.status}")
        payload = json.loads(response.read().decode("utf-8"))

    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise RuntimeError(
            "Unexpected Lidl JSON schema; keys="
            + str(sorted(payload.keys()) if isinstance(payload, dict) else type(payload).__name__)
        )

    items = payload["items"]
    products = [
        parsed
        for item in items if isinstance(item, dict)
        for parsed in [parse_product(item)]
        if parsed is not None
    ]
    return {
        "query": query,
        "sort": sort or "default",
        "master_query": payload.get("masterQuery"),
        "result_type": payload.get("resultType"),
        "details": payload.get("details"),
        "facets": payload.get("facets"),
        "offset": offset,
        "reported_total": payload.get("numFound"),
        "returned_items": len(items),
        "parsed_products": len(products),
        "with_price": sum(product["price_eur"] is not None for product in products),
        "with_reference_price": sum(product["reference_price_eur"] is not None for product in products),
        "with_brand": sum(bool(product["brand"]) for product in products),
        "with_packaging": sum(bool(product["packaging"]) for product in products),
        "with_ean": sum(bool(product["ean"]) for product in products),
        "products_sample": products[:8],
        "product_names": [product["name"] for product in products],
        "category_counts": {
            category: sum(1 for product in products if product["category"] == category)
            for category in sorted({product["category"] for product in products if product["category"]})
        },
        "response_keys": sorted(payload.keys()),
    }


def main() -> int:
    report: dict[str, Any] = {
        "source": "Lidl Spain storefront search endpoint",
        "endpoint": API_URL,
        "read_only": True,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "authentication": "none",
        "requests": [],
    }
    try:
        for query, sort in (("leche", None), ("leche semidesnatada", None), ("aceite", None), ("arroz", None), ("huevos", None), ("yogur", None), ("pan", None), ("", "price")):
            result = fetch(query, sort)
            report["requests"].append(result)
            print(
                f"q={query!r}, sort={sort}: "
                f"{result['parsed_products']} products parsed; "
                f"reported total={result['reported_total']}; "
                f"price={result['with_price']}; EAN={result['with_ean']}"
            )
            time.sleep(1.5)

        empty_searches = [item for item in report["requests"] if item["query"] == ""]
        report["summary"] = {
            "search_api_responds": True,
            "empty_query_reported_total": max(
                (item["reported_total"] or 0 for item in empty_searches), default=0
            ),
            "empty_query_sample_products": sum(item["parsed_products"] for item in empty_searches),
            "empty_query_sample_with_ean": sum(item["with_ean"] for item in empty_searches),
        }
        if not any(item["parsed_products"] for item in report["requests"]):
            raise RuntimeError("Lidl responded, but no product records could be parsed.")
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Probe report written to", OUTPUT)
        return 0
    except urllib.error.HTTPError as error:
        excerpt = error.read().decode("utf-8", errors="replace")[:600]
        report["error"] = {"http_status": error.code, "reason": str(error), "response_excerpt": excerpt}
    except Exception as error:
        report["error"] = {"reason": str(error)}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report.get("error"), ensure_ascii=False), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
