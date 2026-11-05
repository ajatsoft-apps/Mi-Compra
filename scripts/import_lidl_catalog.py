#!/usr/bin/env python3
"""Import Lidl Spain's public online catalogue and in-store offer pages into Supabase.

The public storefront endpoints are undocumented and may change. The importer is
fail-closed: it builds a complete snapshot first and only publishes it after the
catalogue passes the minimum-size and row-count checks.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

API_URL = "https://www.lidl.es/q/api/search"
PAGE_SIZE = 60
PAGE_DELAY_SECONDS = 1.2
HTML_DELAY_SECONDS = 1.5
REGION_NAME = os.getenv("LIDL_REGION_NAME", "Castellón")
MIN_PRODUCTS = int(os.getenv("LIDL_CATALOG_MIN_PRODUCTS", "6000"))
REPORT_PATH = Path(os.getenv("LIDL_CATALOG_REPORT", "lidl-catalog-import-report.json"))

PAGES = {
    "weekly": "https://www.lidl.es/c/store/ofertas-semanales/a10089449",
    "next_week": "https://www.lidl.es/c/store/ofertas-proxima-semana/a10088432",
    "weekend": "https://www.lidl.es/c/store/super-finde/a10089450",
    "next_weekend": "https://www.lidl.es/c/store/super-finde-proxima-semana/a10089609",
    "fresh_produce": "https://www.lidl.es/c/frescos-frutas-y-verduras/s10089404",
    "fresh_fish": "https://www.lidl.es/c/frescos-pescado/s10089403",
    "fresh_meat": "https://www.lidl.es/c/frescos-carne/s10089402",
    "bakery": "https://www.lidl.es/c/panaderia/s10094507",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
DEFAULT_VALID_FROM = "1970-01-01T00:00:00Z"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    text = str(value).strip().replace("\u00a0", "").replace(" ", "")
    if not text:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value))
    text = re.sub(r"<[^>]*>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def iso_datetime(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def first_value(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def normalize_code(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalized_text(value: Any) -> str:
    import unicodedata
    return "".join(
        char for char in unicodedata.normalize("NFKD", str(value or "").casefold())
        if not unicodedata.combining(char)
    )


def make_price_box(
    price: float | None,
    old_price: float | None,
    discount_pct: float | None,
    unit: str,
) -> dict[str, Any] | None:
    if price is None:
        return None
    discount_message = None
    if discount_pct is not None and discount_pct > 0:
        discount_message = "-" + (str(int(discount_pct)) if discount_pct.is_integer() else str(discount_pct)) + "%"
    return {
        "priceSymbol": "€/kg" if unit == "kg" else "€",
        "largePartNumeric": price,
        "smallPartNumeric": old_price,
        "discountMessage": discount_message,
    }


def product_code(data: dict[str, Any]) -> str | None:
    return normalize_code(first_value(
        data.get("nat"),
        as_list(data.get("ians"))[0] if as_list(data.get("ians")) else None,
    ))


def product_brand(data: dict[str, Any]) -> str | None:
    brand = data.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")
    value = clean_text(brand)
    return None if value in ("--", "-") else value


def product_ean(data: dict[str, Any]) -> str | None:
    value = first_value(data.get("ean"), data.get("gtin"), data.get("barcode"), data.get("ean13"))
    if value is not None:
        return normalize_code(value)
    for attribute in as_list(data.get("gs1Attributes")):
        item = as_dict(attribute)
        name = normalized_text(first_value(item.get("name"), item.get("key"), item.get("id")))
        if "ean" in name or "gtin" in name or "barcode" in name:
            found = first_value(item.get("value"), item.get("text"))
            if found:
                return normalize_code(found)
    return None


def category_path(data: dict[str, Any]) -> str | None:
    keyfacts = as_dict(data.get("keyfacts"))
    value = first_value(
        keyfacts.get("wonCategoryPrimaryPath"),
        keyfacts.get("wonCategoryPrimary"),
        data.get("category"),
    )
    return clean_text(value)


def product_common_fields(data: dict[str, Any]) -> dict[str, Any]:
    keyfacts = as_dict(data.get("keyfacts"))
    image_url = first_value(data.get("image"), data.get("imageUrl"))
    if isinstance(image_url, str) and image_url.startswith("/"):
        image_url = "https://www.lidl.es" + image_url
    canonical = data.get("canonicalUrl")
    if isinstance(canonical, str) and canonical.startswith("/"):
        canonical = "https://www.lidl.es" + canonical
    codes = [normalize_code(code) for code in as_list(data.get("ians"))]
    codes = [code for code in codes if code]
    article = product_code(data)
    if article and article not in codes:
        codes.insert(0, article)
    return {
        "product_id": normalize_code(first_value(data.get("productId"), data.get("code"), article)),
        "article_code": article,
        "product_name": clean_text(first_value(data.get("fullTitle"), keyfacts.get("fullTitle"), keyfacts.get("title"), data.get("title"))) or "Producto Lidl",
        "brand": product_brand(data),
        "category": category_path(data),
        "description": clean_text(keyfacts.get("description")),
        "image_url": image_url,
        "product_url": canonical,
        "store_available": data.get("store") if isinstance(data.get("store"), bool) else None,
        "online_available": as_dict(data.get("stockAvailability")).get("onlineAvailable"),
        "availability_indicator": as_dict(data.get("stockAvailability")).get("availabilityIndicator"),
        "ean": product_ean(data),
        "internal_codes": codes,
    }


def normalize_price_payload(wrapper: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    outer = as_dict(wrapper)
    nested = outer.get("price")
    if isinstance(nested, dict):
        return nested, outer
    return outer, outer


def price_record(
    common: dict[str, Any],
    wrapper: Any,
    price_type: str,
    source: str,
    source_page: str,
    captured_at: str,
    requires_lidl_plus: bool = False,
    fallback_valid_from: Any = None,
    fallback_valid_until: Any = None,
) -> dict[str, Any] | None:
    price_data, outer = normalize_price_payload(wrapper)
    price = to_number(price_data.get("price"))
    if price is None:
        price = to_number(outer.get("price"))
    discount = as_dict(first_value(price_data.get("discount"), outer.get("discount")))
    old_price = to_number(first_value(
        price_data.get("oldPrice"),
        discount.get("deletedPrice"),
        outer.get("oldPrice"),
    ))
    discount_pct = to_number(first_value(
        discount.get("percentageDiscount"),
        outer.get("percentageDiscount"),
    ))
    packaging_obj = first_value(price_data.get("packaging"), outer.get("packaging"))
    packaging = packaging_obj.get("text") if isinstance(packaging_obj, dict) else packaging_obj
    packaging = clean_text(packaging)
    base_obj = first_value(price_data.get("basePrice"), outer.get("basePrice"))
    base_price_text = clean_text(base_obj.get("text") if isinstance(base_obj, dict) else base_obj)
    valid_from = iso_datetime(first_value(
        price_data.get("startDate"), outer.get("startDate"), fallback_valid_from
    )) or DEFAULT_VALID_FROM
    valid_until = iso_datetime(first_value(
        price_data.get("endDateExclusive"), price_data.get("endDate"),
        outer.get("endDateExclusive"), outer.get("endDate"), fallback_valid_until
    ))
    unit = "kg" if "granel" in normalized_text(common["product_name"]) else "ud."
    price_box = make_price_box(price, old_price, discount_pct, unit)
    return {
        **common,
        "packaging": packaging,
        "unit": unit,
        "unit_price": price,
        "old_price": old_price,
        "discount_pct": discount_pct,
        "requires_lidl_plus": requires_lidl_plus,
        "base_price_text": base_price_text,
        "price_box": price_box,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "source": source,
        "source_page": source_page,
        "price_type": price_type,
        "captured_at": captured_at,
    }


def parse_online_product(item: dict[str, Any], captured_at: str) -> dict[str, Any] | None:
    data = as_dict(as_dict(item.get("gridbox")).get("data"))
    if not data:
        data = as_dict(item.get("data"))
    if not data:
        return None
    common = product_common_fields(data)
    if not common["product_id"]:
        return None
    price_data = as_dict(data.get("price"))
    price = to_number(first_value(price_data.get("price"), price_data.get("amount")))
    old_price = to_number(price_data.get("oldPrice"))
    discount = as_dict(price_data.get("discount"))
    discount_pct = to_number(discount.get("percentageDiscount"))
    packaging_obj = as_dict(price_data.get("packaging"))
    base_obj = as_dict(price_data.get("basePrice"))
    unit = "ud."
    row = {
        **common,
        "packaging": clean_text(packaging_obj.get("text")),
        "unit": unit,
        "unit_price": price,
        "old_price": old_price,
        "discount_pct": discount_pct,
        "requires_lidl_plus": False,
        "base_price_text": clean_text(base_obj.get("text")),
        "price_box": make_price_box(price, old_price, discount_pct, unit),
        "valid_from": DEFAULT_VALID_FROM,
        "valid_until": None,
        "source": "online",
        "source_page": "search",
        "price_type": "online",
        "captured_at": captured_at,
    }
    return row


class ProductAttributeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.products: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name == "data-grid-data" and value:
                parsed = None
                try:
                    parsed = json.loads(value)
                except json.JSONDecodeError:
                    try:
                        parsed = json.loads(html.unescape(value))
                    except json.JSONDecodeError:
                        parsed = None
                if isinstance(parsed, dict) and parsed.get("productId"):
                    self.products.append(parsed)


def resolve_price_region(product: dict[str, Any], region_name: str) -> str | None:
    regions = as_dict(product.get("regionsV2"))
    target = normalized_text(region_name)
    for meta in regions.values():
        meta = as_dict(meta)
        name = normalized_text(meta.get("regionName"))
        if target and (target == name or target in name or name in target):
            region_id = normalize_code(meta.get("regionPriceId"))
            if region_id:
                return region_id
    prices = as_dict(product.get("regionsPrices"))
    if prices:
        return str(next(iter(prices.keys())))
    return None


def parse_page_product(
    product: dict[str, Any],
    page_name: str,
    captured_at: str,
    region_name: str,
) -> list[dict[str, Any]]:
    common = product_common_fields(product)
    if not common["product_id"]:
        return []
    regions_prices = as_dict(product.get("regionsPrices"))
    region_id = resolve_price_region(product, region_name)
    region_price = as_dict(regions_prices.get(str(region_id))) if region_id else {}
    if not region_price and regions_prices:
        region_price = as_dict(next(iter(regions_prices.values())))
    source = "category" if page_name in {"fresh_produce", "fresh_fish", "fresh_meat", "bakery"} else "weekly"
    fallback_start = product.get("storeStartDate")
    fallback_end = product.get("storeEndDate")
    records: list[dict[str, Any]] = []

    current_regular = region_price.get("currentPrice")
    if current_regular is not None:
        row = price_record(common, current_regular, "regular", source, page_name, captured_at,
                           False, fallback_start, fallback_end)
        if row and row["unit_price"] is not None:
            records.append(row)

    current_plus = region_price.get("currentLidlPlusPrice")
    if current_plus is not None:
        row = price_record(common, current_plus, "lidlplus", source, page_name, captured_at,
                           True, fallback_start, fallback_end)
        if row and row["unit_price"] is not None:
            regular_data, _ = normalize_price_payload(current_regular)
            if row["old_price"] is None:
                row["old_price"] = to_number(regular_data.get("price"))
                row["price_box"] = make_price_box(row["unit_price"], row["old_price"], row["discount_pct"], row["unit"])
            records.append(row)

    for item in as_list(region_price.get("futurePrices")):
        row = price_record(common, item, "future_regular", source, page_name, captured_at,
                           False, fallback_start, fallback_end)
        if row and row["unit_price"] is not None:
            records.append(row)

    for item in as_list(region_price.get("futureLidlPlusPrices")):
        row = price_record(common, item, "future_lidlplus", source, page_name, captured_at,
                           True, fallback_start, fallback_end)
        if row and row["unit_price"] is not None:
            records.append(row)

    if not records:
        records.append({
            **common,
            "packaging": None,
            "unit": "kg" if "granel" in normalized_text(common["product_name"]) else "ud.",
            "unit_price": None,
            "old_price": None,
            "discount_pct": None,
            "requires_lidl_plus": False,
            "base_price_text": None,
            "price_box": None,
            "valid_from": iso_datetime(fallback_start) or DEFAULT_VALID_FROM,
            "valid_until": iso_datetime(fallback_end),
            "source": source,
            "source_page": page_name,
            "price_type": "no_price",
            "captured_at": captured_at,
        })
    return records


def fetch_catalog_page(sort: str, offset: int) -> tuple[list[dict[str, Any]], int]:
    params = urllib.parse.urlencode({
        "assortment": "ES",
        "locale": "es_ES",
        "version": "2.0",
        "q": "",
        "sort": sort,
        "offset": str(offset),
        "fetchsize": str(PAGE_SIZE),
    })
    request = urllib.request.Request(
        API_URL + "?" + params,
        headers={
            "Accept": "*/*",
            "Accept-Language": "es-ES,es;q=0.9",
            "User-Agent": USER_AGENT,
        },
    )
    payload = fetch_json_request(request)
    items = as_list(payload.get("items"))
    total = int(payload.get("numFound") or payload.get("total") or len(items))
    return items, total


def fetch_json_request(request: urllib.request.Request) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else min(60, 5 * (2 ** attempt))
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == 4:
                raise
            time.sleep(min(60, 5 * (2 ** attempt)))
    raise RuntimeError("Lidl API request failed: " + str(last_error))


def fetch_html(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9",
            "User-Agent": USER_AGENT,
        },
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                if response.status != 200:
                    raise RuntimeError("Lidl page returned HTTP " + str(response.status))
                return response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else min(60, 5 * (2 ** attempt))
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == 3:
                raise
            time.sleep(min(60, 5 * (2 ** attempt)))
    raise RuntimeError("Lidl page request failed: " + str(last_error))


def crawl_online_catalog(max_pages: int | None, captured_at: str) -> tuple[dict[str, dict[str, Any]], int, dict[str, Any]]:
    products: dict[str, dict[str, Any]] = {}
    reported_total = 0
    pass_stats: list[dict[str, Any]] = []
    for sort in ("price", "price-desc"):
        offset = 0
        fetched = 0
        page_count = 0
        while True:
            items, total = fetch_catalog_page(sort, offset)
            reported_total = max(reported_total, total)
            page_count += 1
            fetched += len(items)
            for item in items:
                row = parse_online_product(as_dict(item), captured_at)
                if not row:
                    continue
                key = row["product_id"]
                previous = products.get(key)
                if previous is None:
                    products[key] = row
                else:
                    for field, value in row.items():
                        if value not in (None, "", [], {}):
                            previous[field] = value
            if not items or offset + len(items) >= total:
                break
            offset += len(items)
            if max_pages is not None and page_count >= max_pages:
                break
            time.sleep(PAGE_DELAY_SECONDS)
        pass_stats.append({
            "sort": sort,
            "reported_total": total,
            "pages": page_count,
            "records_seen": fetched,
            "unique_products_so_far": len(products),
        })
    return products, reported_total, {"passes": pass_stats}


def crawl_store_pages(captured_at: str, region_name: str) -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
    records: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    page_stats: list[dict[str, Any]] = []
    resolved_region_ids: set[str] = set()
    for index, (page_name, url) in enumerate(PAGES.items()):
        page_html = fetch_html(url)
        parser = ProductAttributeParser()
        parser.feed(page_html)
        page_products = parser.products
        before = len(records)
        for product in page_products:
            region_id = resolve_price_region(product, region_name)
            if region_id:
                resolved_region_ids.add(str(region_id))
            for row in parse_page_product(product, page_name, captured_at, region_name):
                key = (
                    row["product_id"],
                    row["source"],
                    row["source_page"],
                    row["price_type"],
                    row["valid_from"],
                )
                records[key] = row
        page_stats.append({
            "page": page_name,
            "url": url,
            "html_bytes": len(page_html.encode("utf-8")),
            "product_cards": len(page_products),
            "unique_price_records_added": len(records) - before,
        })
        if index < len(PAGES) - 1:
            time.sleep(HTML_DELAY_SECONDS)
    return list(records.values()), {"pages": page_stats}, sorted(resolved_region_ids)


def insert_snapshot(
    supabase_url: str,
    service_key: str,
    captured_at: str,
    region_name: str,
    price_region_id: str,
    reported_total: int,
    expected_count: int,
    source_pages: list[str],
) -> str:
    payload = {
        "source": "lidl_es_search_and_pages",
        "status": "staging",
        "region_name": region_name,
        "price_region_id": price_region_id,
        "reported_total": reported_total,
        "expected_count": expected_count,
        "source_pages": source_pages,
        "captured_at": captured_at,
    }
    request = urllib.request.Request(
        supabase_url.rstrip("/") + "/rest/v1/lidl_catalog_snapshots?select=id",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": "Bearer " + service_key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        rows = json.loads(response.read().decode("utf-8"))
    if not rows or not rows[0].get("id"):
        raise RuntimeError("Supabase did not return the new Lidl catalog snapshot id.")
    return str(rows[0]["id"])


def insert_observations(
    supabase_url: str,
    service_key: str,
    snapshot_id: str,
    rows: list[dict[str, Any]],
) -> None:
    endpoint = supabase_url.rstrip("/") + "/rest/v1/lidl_catalog_observations"
    batch_size = 250
    for start in range(0, len(rows), batch_size):
        batch = []
        for row in rows[start:start + batch_size]:
            item = dict(row)
            item["snapshot_id"] = snapshot_id
            batch.append(item)
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(batch, ensure_ascii=False).encode("utf-8"),
            headers={
                "apikey": service_key,
                "Authorization": "Bearer " + service_key,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            response.read()
        print("Supabase: inserted", min(start + batch_size, len(rows)), "of", len(rows))


def publish_snapshot(
    supabase_url: str,
    service_key: str,
    snapshot_id: str,
    expected_count: int,
    minimum_count: int,
) -> dict[str, Any]:
    request = urllib.request.Request(
        supabase_url.rstrip("/") + "/rest/v1/rpc/publish_lidl_catalog_snapshot",
        data=json.dumps({
            "p_snapshot_id": snapshot_id,
            "p_expected_count": expected_count,
            "p_minimum_count": minimum_count,
        }).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": "Bearer " + service_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-online-catalog", action="store_true")
    parser.add_argument("--max-pages", type=int, default=None)
    args = parser.parse_args()
    if args.max_pages is not None:
        args.dry_run = True

    captured_at = now_iso()
    report: dict[str, Any] = {
        "captured_at": captured_at,
        "region_name": REGION_NAME,
        "dry_run": args.dry_run,
        "pages": {},
        "online_catalog": {},
        "row_count": 0,
        "published": False,
    }
    try:
        online_products: dict[str, dict[str, Any]] = {}
        reported_total = 0
        online_stats: dict[str, Any] = {}
        if not args.skip_online_catalog:
            online_products, reported_total, online_stats = crawl_online_catalog(args.max_pages, captured_at)
        report["online_catalog"] = {
            **online_stats,
            "reported_total": reported_total,
            "unique_products": len(online_products),
            "with_price": sum(1 for row in online_products.values() if row["unit_price"] is not None),
            "with_brand": sum(1 for row in online_products.values() if row["brand"]),
            "with_packaging": sum(1 for row in online_products.values() if row["packaging"]),
            "with_ean": sum(1 for row in online_products.values() if row["ean"]),
        }

        page_rows, page_stats, region_ids = crawl_store_pages(captured_at, REGION_NAME)
        report["pages"] = page_stats
        report["resolved_region_price_ids"] = region_ids

        all_rows: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
        for row in online_products.values():
            key = (row["product_id"], row["source"], row["source_page"], row["price_type"], row["valid_from"])
            all_rows[key] = row
        for row in page_rows:
            key = (row["product_id"], row["source"], row["source_page"], row["price_type"], row["valid_from"])
            all_rows[key] = row

        rows = list(all_rows.values())
        report["row_count"] = len(rows)
        report["online_product_count"] = len(online_products)
        report["store_page_price_records"] = len(page_rows)
        report["unique_product_keys"] = len({row["product_id"] for row in rows})
        report["source_counts"] = {
            source: sum(1 for row in rows if row["source"] == source)
            for source in ("online", "weekly", "category")
        }
        report["price_counts"] = {
            "with_price": sum(1 for row in rows if row["unit_price"] is not None),
            "with_lidl_plus": sum(1 for row in rows if row["requires_lidl_plus"]),
            "with_ean": sum(1 for row in rows if row["ean"]),
        }

        if args.dry_run:
            print(json.dumps(report, ensure_ascii=False, indent=2))
            REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return 0

        if len(online_products) < MIN_PRODUCTS:
            raise RuntimeError(
                "Online Lidl catalogue is incomplete: expected at least "
                + str(MIN_PRODUCTS) + " unique products, received " + str(len(online_products))
            )

        supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
        service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not supabase_url or not service_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for a real import.")

        region_price_id = region_ids[0] if region_ids else "1"
        source_pages = list(PAGES.keys()) + ["online_search_price", "online_search_price_desc"]
        snapshot_id = insert_snapshot(
            supabase_url, service_key, captured_at, REGION_NAME, region_price_id,
            reported_total, len(rows), source_pages
        )
        report["snapshot_id"] = snapshot_id
        insert_observations(supabase_url, service_key, snapshot_id, rows)
        published = publish_snapshot(
            supabase_url, service_key, snapshot_id, len(rows), MIN_PRODUCTS
        )
        report["published"] = True
        report["publish_result"] = published
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        report["error"] = str(error)
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Lidl catalog import failed:", error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
