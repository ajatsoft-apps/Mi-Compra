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



def fetch_catalog_page(sort: str, offset: int) -> dict[str, Any]:
    params = {
        "assortment": "ES",
        "locale": "es_ES",
        "version": "2.0",
        "q": "",
        "sort": sort,
        "offset": str(offset),
        "fetchsize": "60",
    }
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
            raise RuntimeError(f"Unexpected HTTP {response.status} at offset {offset}")
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise RuntimeError(f"Invalid catalogue page at offset {offset}")
    return payload


def crawl_full_catalog() -> dict[str, Any]:
    products_by_id: dict[str, dict[str, Any]] = {}
    passes: list[dict[str, Any]] = []
    reported_totals: set[int] = set()
    duplicate_records = 0

    for sort in ("price", "price-desc"):
        offset = 0
        page_sizes: list[int] = []
        returned = 0
        page_count = 0
        while page_count < 250:
            payload = fetch_catalog_page(sort, offset)
            items = payload["items"]
            total = int(payload.get("numFound") or 0)
            if total:
                reported_totals.add(total)
            page_size = len(items)
            page_sizes.append(page_size)
            page_count += 1
            returned += page_size
            for item in items:
                if not isinstance(item, dict):
                    continue
                product = parse_product(item)
                if not product or not product.get("product_id"):
                    continue
                product_id = product["product_id"]
                if product_id in products_by_id:
                    duplicate_records += 1
                    continue
                products_by_id[product_id] = product
            if page_size == 0 or offset + page_size >= total:
                break
            offset += page_size
            time.sleep(1.2)
        else:
            raise RuntimeError(f"Pagination safety limit reached for sort={sort}")
        passes.append({
            "sort": sort,
            "reported_total": total,
            "pages": page_count,
            "records_returned": returned,
            "page_sizes": page_sizes,
            "max_page_size": max(page_sizes, default=0),
        })

    products = list(products_by_id.values())
    categories: dict[str, int] = {}
    for product in products:
        category = str(product.get("category") or "Sin categoría")
        categories[category] = categories.get(category, 0) + 1
    categories = dict(sorted(categories.items(), key=lambda item: (-item[1], item[0])))

    return {
        "passes": passes,
        "reported_totals": sorted(reported_totals),
        "unique_products": len(products),
        "duplicate_records_ignored": duplicate_records,
        "with_price": sum(product.get("price_eur") is not None for product in products),
        "with_brand": sum(bool(product.get("brand")) for product in products),
        "with_packaging": sum(bool(product.get("packaging")) for product in products),
        "with_image": sum(bool(product.get("image_url")) for product in products),
        "with_ean": sum(bool(product.get("ean")) for product in products),
        "category_counts": categories,
        "sample_food_products": [
            {
                "id": product.get("product_id"),
                "name": product.get("name"),
                "category": product.get("category"),
                "brand": product.get("brand"),
                "price": product.get("price_eur"),
                "packaging": product.get("packaging"),
                "ean": product.get("ean"),
                "image": product.get("image_url"),
            }
            for product in products
            if any(token in str(product.get("category") or "").casefold()
                   for token in ("fruta", "verdura", "carne", "pescado", "yogur", "pan", "arroz", "conserva", "refresco", "galleta"))
        ][:60],
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
        print("Starting full read-only catalogue pagination check…")
        report["full_catalog"] = crawl_full_catalog()
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
