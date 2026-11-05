#!/usr/bin/env python3
"""Read-only probe of Lidl Spain's weekly-offers API.

Uses a normal HTTP client without login, cookies, tokens, browser impersonation,
or anti-bot workarounds.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORES_URL = "https://stores.lidlplus.com/api/v4/ES"
OFFERS_URL = "https://offers.lidlplus.com/app/api/v4/ES/{store_key}/offers"
POSTAL_CODE = os.getenv("LIDL_POSTAL_CODE", "12006").strip()
OUTPUT = Path(os.getenv("LIDL_PROBE_OUTPUT", "lidl-offers-probe.json"))


def get_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Language": "es-ES,es;q=0.9",
            "User-Agent": "MiCompra-LidlOffersProbe/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} from {url}")
        return json.loads(response.read().decode("utf-8"))


def normalize(value: Any) -> str:
    value = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(char for char in value if not unicodedata.combining(char))


def main() -> int:
    result: dict[str, Any] = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "country": "ES",
        "postal_code_query": POSTAL_CODE,
        "transport": "urllib; no login, cookies, tokens or impersonation",
    }
    try:
        stores = get_json(STORES_URL)
        if not isinstance(stores, list):
            raise RuntimeError("Store endpoint did not return a JSON array")

        matches = [
            store
            for store in stores
            if isinstance(store, dict)
            and POSTAL_CODE in re.sub(r"\D", "", str(store.get("postalCode", "")))
            and store.get("storeKey")
        ]
        match_method = "postal_code"

        if not matches:
            matches = [
                store
                for store in stores
                if isinstance(store, dict)
                and (
                    "castello" in normalize(store.get("locality"))
                    or "castellon" in normalize(store.get("locality"))
                    or "castellon" in normalize(store.get("province"))
                )
                and store.get("storeKey")
            ]
            match_method = "Castello_or_Castellon_locality_or_province"

        result["store_catalog_count"] = len(stores)
        result["match_method"] = match_method
        result["matching_store_count"] = len(matches)
        result["matching_stores"] = [
            {
                "store_key": store.get("storeKey"),
                "name": store.get("name"),
                "postal_code": store.get("postalCode"),
                "locality": store.get("locality"),
                "province": store.get("province"),
            }
            for store in matches[:20]
        ]

        if not matches:
            result["status"] = "no_matching_store"
            OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2

        store = matches[0]
        store_key = str(store["storeKey"])
        result["selected_store"] = result["matching_stores"][0]

        payload = get_json(OFFERS_URL.format(store_key=store_key))
        offers = payload.get("offers", []) if isinstance(payload, dict) else []
        if not isinstance(offers, list):
            raise RuntimeError("Offers endpoint did not return an offers array")

        field_counts: dict[str, int] = {}
        ean_keys = {"ean", "gtin", "codeInput", "barcode", "productEan"}
        ean_count = 0
        normalized_offers: list[dict[str, Any]] = []

        for offer in offers:
            if not isinstance(offer, dict):
                continue
            for key, value in offer.items():
                if value not in (None, "", [], {}):
                    field_counts[key] = field_counts.get(key, 0) + 1
            if any(offer.get(key) for key in ean_keys):
                ean_count += 1

            normalized_offers.append(
                {
                    "id": offer.get("id"),
                    "title": offer.get("title"),
                    "brand": offer.get("brand"),
                    "category": offer.get("category"),
                    "offer_type": offer.get("offerType"),
                    "redemption_channel": offer.get("redemptionChannel"),
                    "product_ids": offer.get("productIds"),
                    "start_validity_date": offer.get("startValidityDate"),
                    "end_validity_date": offer.get("endValidityDate"),
                    "price_box": offer.get("priceBox"),
                    "packaging": offer.get("packaging"),
                    "price_per_unit": offer.get("pricePerUnit"),
                    "ean_fields": {key: offer.get(key) for key in ean_keys if offer.get(key)},
                }
            )

        result.update(
            {
                "status": "ok",
                "offer_count": len(normalized_offers),
                "offers_with_explicit_ean": ean_count,
                "nonempty_field_counts": field_counts,
                "offers": normalized_offers,
            }
        )
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(
            json.dumps(
                {key: value for key, value in result.items() if key != "offers"},
                ensure_ascii=False,
                indent=2,
            )
        )
        print(f"Saved {len(normalized_offers)} offers to {OUTPUT}")
        return 0
    except urllib.error.HTTPError as exc:
        result.update(
            {"status": "http_error", "http_status": exc.code, "error": str(exc)}
        )
    except Exception as exc:
        result.update({"status": "error", "error": str(exc)})

    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1


if __name__ == "__main__":
    sys.exit(main())
