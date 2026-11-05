#!/usr/bin/env python3
"""Read-only probe of Lidl Spain's public weekly food-offer pages."""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

PAGES = {
    "weekly": "https://www.lidl.es/c/store/ofertas-semanales/a10089449",
    "next_week": "https://www.lidl.es/c/store/ofertas-proxima-semana/a10088432",
    "weekend": "https://www.lidl.es/c/store/super-finde/a10089450",
    "next_weekend": "https://www.lidl.es/c/store/super-finde-proxima-semana/a10089609",
}
OUTPUT = Path("lidl-food-page-probe.json")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
TARGETS = ("Patata granel", "Aguacate granel", "Atún claro natural", "Leche")


class ScriptParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.scripts: list[dict[str, Any]] = []
        self.product_attributes: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for key, value in attrs:
            if value and any(marker in value.casefold() for marker in ('productid', 'regionsprices', 'pricebox')):
                decoded = value
                position = -1
                for marker in ('productId', 'regionsPrices', 'priceBox'):
                    position = decoded.casefold().find(marker.casefold())
                    if position >= 0:
                        break
                self.product_attributes.append({
                    "tag": tag,
                    "attribute": key,
                    "length": len(value),
                    "snippet": decoded[max(0, position - 180):position + 900] if position >= 0 else decoded[:900],
                    "value": value,
                })
        if tag.lower() == "script":
            attributes = dict(attrs)
            self.current = {
                "id": attributes.get("id"),
                "type": attributes.get("type"),
                "src": attributes.get("src"),
                "text": "",
            }

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self.current is not None:
            self.scripts.append(self.current)
            self.current = None


def fetch_page(name: str, url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        body = response.read()
        content_type = response.headers.get("Content-Type", "")
        final_url = response.geturl()
        status = response.status
    html = body.decode("utf-8", errors="replace")
    parser = ScriptParser()
    parser.feed(html)
    scripts = parser.scripts
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else None

    parsed_products = []
    category_counts: dict[str, int] = {}
    for attribute in parser.product_attributes:
        raw_value = attribute.get("value") or ""
        try:
            product = json.loads(raw_value)
        except (json.JSONDecodeError, TypeError):
            try:
                import html as html_module
                product = json.loads(html_module.unescape(raw_value))
            except (json.JSONDecodeError, TypeError):
                continue
        if not isinstance(product, dict) or not product.get("productId"):
            continue
        keyfacts = product.get("keyfacts") or {}
        category = keyfacts.get("wonCategoryPrimary") or ""
        category_counts[category] = category_counts.get(category, 0) + 1
        regions_v2 = product.get("regionsV2") or {}
        regions_prices = product.get("regionsPrices") or {}
        region_samples = []
        for region_id, region_meta in list(regions_v2.items())[:4]:
            region_price = regions_prices.get(str(region_id)) or {}
            plus = region_price.get("currentLidlPlusPrice") or {}
            price_data = plus.get("price") or region_price.get("price") or {}
            region_samples.append({
                "region_id": str(region_id),
                "region_name": region_meta.get("regionName") if isinstance(region_meta, dict) else None,
                "region_status": region_meta.get("status") if isinstance(region_meta, dict) else None,
                "price_keys": sorted(region_price.keys()) if isinstance(region_price, dict) else [],
                "price": price_data.get("price") if isinstance(price_data, dict) else None,
                "old_price": price_data.get("oldPrice") if isinstance(price_data, dict) else None,
                "packaging": (price_data.get("packaging") or {}).get("text") if isinstance(price_data, dict) else None,
                "discount": (price_data.get("discount") or {}).get("percentageDiscount") if isinstance(price_data, dict) else None,
            })
        brand = product.get("brand") or {}
        parsed_products.append({
            "product_id": str(product.get("productId")),
            "title": product.get("fullTitle") or keyfacts.get("fullTitle") or keyfacts.get("title"),
            "brand": brand.get("name") if isinstance(brand, dict) else brand,
            "category": category,
            "analytics_category": keyfacts.get("analyticsCategory"),
            "image_url": product.get("image"),
            "product_url": ("https://www.lidl.es" + product["canonicalUrl"]) if str(product.get("canonicalUrl") or "").startswith("/") else product.get("canonicalUrl"),
            "internal_codes": product.get("ians") or [],
            "ean": product.get("ean") or product.get("gtin") or product.get("barcode"),
            "store": product.get("store"),
            "store_end_date": product.get("storeEndDate"),
            "regions_with_prices": len(regions_prices),
            "region_samples": region_samples,
            "top_level_keys": sorted(product.keys()),
        })

    script_summaries = []
    for script in scripts:
        text = script["text"]
        script_summaries.append({
            "id": script["id"],
            "type": script["type"],
            "src": script["src"],
            "length": len(text),
            "contains_product_name": any(target.casefold() in text.casefold() for target in TARGETS),
            "contains_product_or_offer_keys": any(
                key in text for key in ('"price"', '"productId"', '"productName"', '"offer"', '"ean"', '"gtin"')
            ),
        })

    snippets = {}
    for target in TARGETS:
        position = html.casefold().find(target.casefold())
        if position >= 0:
            snippets[target] = html[max(0, position - 1200):position + 2200]

    return {
        "name": name,
        "url": url,
        "final_url": final_url,
        "http_status": status,
        "content_type": content_type,
        "html_bytes": len(body),
        "page_title": title,
        "script_count": len(scripts),
        "scripts": script_summaries,
        "product_attribute_count": len(parser.product_attributes),
        "parsed_product_count": len(parsed_products),
        "unique_product_count": len({item["product_id"] for item in parsed_products}),
        "category_counts": category_counts,
        "products_sample": parsed_products[:20],
        "product_snippets": snippets,
        "has_product_json": any(item["contains_product_name"] for item in script_summaries),
    }


def main() -> int:
    report: dict[str, Any] = {
        "source": "Lidl Spain public weekly offer pages",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "read_only": True,
        "authentication": "none",
        "pages": [],
    }
    try:
        for index, (name, url) in enumerate(PAGES.items()):
            result = fetch_page(name, url)
            report["pages"].append(result)
            print(
                f"{name}: HTTP {result['http_status']}, "
                f"{result['html_bytes']} bytes, "
                f"{result['script_count']} scripts, "
                f"product JSON={result['has_product_json']}"
            )
            if index < len(PAGES) - 1:
                time.sleep(1.5)
        if not any(page["http_status"] == 200 for page in report["pages"]):
            raise RuntimeError("No Lidl food-offer page could be fetched.")
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
