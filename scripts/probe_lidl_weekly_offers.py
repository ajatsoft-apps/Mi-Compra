#!/usr/bin/env python3
"""Read-only probe of Lidl Spain's public weekly-offers API.

This probe deliberately uses a normal HTTP client without login, cookies,
private tokens, browser impersonation, or anti-bot workarounds.
"""

from __future__ import annotations

import json
import os
import sys
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
            and str(store.get("postalCode", "")).strip() == POSTAL_CODE
            and store.get("storeKey")
        ]
        if not matches:
            locality_matches = [
                store
                for store in stores
                if isinstance(store, dict)
                and "castell" in str(store.get("locality", "")).casefold()
                and store.get("storeKey")
            ]
            matches = locality_matches

        result["store_catalog_count"] = len(stores)
        result["matching_store_count"] = len(matches)
        if not matches:
            result["status"] = "no_matching_store"
            OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2

        store = matches[0]
        store_key = str(store["storeKey"])
        result["selected_store"] = {
            "store_key": store_key,
            "name": store.get("name"),
            "postal_code": store.get("postalCode"),
            "locality": store.get("locality"),
            "province": store.get("province"),
        }

        payload = get_json(OFFERS_URL.format(store_key=store_key))
        offers = payload.get("offers", []) if isinstance(payload, dict) else []
        if not isinstance(offers, list):
            raise RuntimeError("Offers endpoint did not return an offers array")

        field_counts: dict[str, int] = {}
        ean_keys = {"ean", "gtin", "codeInput", "barcode", "productEan"}
        ean_count = 0
        normalized: list[dict[str, Any]] = []
        for offer in offers:
            if not isinstance(offer, dict):
                continue
            for key, value in offer.items():
                if value not in (None, "", [], {}):
                    field_counts[key] = field_counts.get(key, 0) + 1
            if any(offer.get(key) for key in ean_keys):
                ean_count += 1
            normalized.append(
                {
                    "id": offer.get("id"),
                    "title": offer.get("title"),
                    "brand": offer.get("brand"),
                    "category": offer.get("category"),
                    "offer_type": offer.get("offerType"),
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
                "offer_count": len(normalized),
                "offers_with_explicit_ean": ean_count,
                "nonempty_field_counts": field_counts,
                "offers": normalized,
            }
        )
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({k: v for k, v in result.items() if k != "offers"}, ensure_ascii=False, indent=2))
        print(f"Saved {len(normalized)} offers to {OUTPUT}")
        return 0
    except urllib.error.HTTPError as exc:
        result.update({"status": "http_error", "http_status": exc.code, "error": str(exc)})
    except Exception as exc:
        result.update({"status": "error", "error": str(exc)})

    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1


if __name__ == "__main__":
    sys.exit(main())
