#!/usr/bin/env python3
"""Import Lidl weekly offers into household-scoped Supabase tables.

Uses only ordinary unauthenticated HTTP requests to the observed Lidl endpoints.
No Lidl account, cookies, token, TLS impersonation, proxy rotation or EAN inference.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

STORES_URL = "https://stores.lidlplus.com/api/v4/ES"
OFFERS_URL = "https://offers.lidlplus.com/app/api/v4/ES/{store_key}/offers"
USER_AGENT = "MiCompra-LidlOffersImporter/1.0"


def request_json(url: str, headers: dict[str, str] | None = None) -> Any:
    request_headers = {
        "Accept": "application/json",
        "Accept-Language": "es-ES,es;q=0.9",
        "User-Agent": USER_AGENT,
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(request, timeout=25) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {url}")
        return json.loads(response.read().decode("utf-8"))


def parse_datetime(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def normalize_offer(offer: dict[str, Any]) -> dict[str, Any] | None:
    offer_id = offer.get("id")
    title = offer.get("title")
    if offer_id is None or not str(title or "").strip():
        return None
    product_ids = offer.get("productIds")
    if isinstance(product_ids, (str, int)):
        product_ids = [str(product_ids)]
    if not isinstance(product_ids, list):
        product_ids = []
    price_box = offer.get("priceBox")
    return {
        "offer_id": str(offer_id),
        "title": str(title).strip(),
        "brand": str(offer["brand"]).strip() if offer.get("brand") else None,
        "category": str(offer["category"]).strip() if offer.get("category") else None,
        "offer_type": str(offer["offerType"]).strip() if offer.get("offerType") else None,
        "redemption_channel": str(offer["redemptionChannel"]).strip() if offer.get("redemptionChannel") else None,
        "product_ids": [str(value) for value in product_ids if value is not None],
        "start_validity_date": parse_datetime(offer.get("startValidityDate")),
        "end_validity_date": parse_datetime(offer.get("endValidityDate")),
        "price_box": price_box if isinstance(price_box, dict) else None,
        "image_url": str(offer["imageUrl"]).strip() if offer.get("imageUrl") else None,
    }


def supabase_headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def main() -> int:
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    store_keys = [value.strip() for value in os.getenv("LIDL_STORE_KEYS", "").split(",") if value.strip()]
    if not supabase_url.startswith("https://") or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    if not store_keys:
        raise RuntimeError("Set LIDL_STORE_KEYS to an explicit comma-separated list of store keys.")

    stores = request_json(STORES_URL)
    if not isinstance(stores, list):
        raise RuntimeError("Lidl store endpoint did not return an array.")
    store_by_key = {
        str(store.get("storeKey")): store
        for store in stores
        if isinstance(store, dict) and store.get("storeKey") is not None
    }
    missing = [key for key in store_keys if key not in store_by_key]
    if missing:
        raise RuntimeError("Unknown store keys in Lidl Spain store catalogue: " + ", ".join(missing))

    households_url = supabase_url + "/rest/v1/households?select=id"
    households = request_json(households_url, supabase_headers(service_key))
    if not isinstance(households, list) or not households:
        raise RuntimeError("No household records were returned by Supabase; nothing imported.")
    household_ids = [str(row["id"]) for row in households if isinstance(row, dict) and row.get("id")]
    if not household_ids:
        raise RuntimeError("No valid household IDs were returned by Supabase.")

    captured_at = datetime.now(timezone.utc).isoformat()
    imported = 0
    for store_key in store_keys:
        store = store_by_key[store_key]
        store_name = str(store.get("name") or store_key)
        postal_code = str(store.get("postalCode") or "")
        source_url = OFFERS_URL.format(store_key=urllib.parse.quote(store_key, safe=""))
        payload = request_json(source_url)
        raw_offers = payload.get("offers", []) if isinstance(payload, dict) else []
        if not isinstance(raw_offers, list):
            raise RuntimeError(f"Invalid offers payload for store {store_key}.")
        offers = [
            normalized
            for raw in raw_offers
            if isinstance(raw, dict)
            for normalized in [normalize_offer(raw)]
            if normalized is not None
        ]
        if not offers:
            raise RuntimeError(f"No valid offers returned for store {store_key}; refusing to publish an empty snapshot.")
        if len(offers) > 500:
            raise RuntimeError(f"Unexpected offer count for store {store_key}: {len(offers)}.")

        for household_id in household_ids:
            body = {
                "p_household_id": household_id,
                "p_store_key": store_key,
                "p_store_name": store_name,
                "p_store_postal_code": postal_code or None,
                "p_captured_at": captured_at,
                "p_source_url": source_url,
                "p_offers": offers,
            }
            rpc_url = supabase_url + "/rest/v1/rpc/publish_lidl_offer_snapshot"
            request = urllib.request.Request(
                rpc_url,
                data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                headers=supabase_headers(service_key),
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=45) as response:
                if response.status not in (200, 201, 204):
                    raise RuntimeError(f"Supabase RPC returned HTTP {response.status} for {store_key}.")
                response.read()
            imported += len(offers)
        print(f"{store_key} · {store_name}: {len(offers)} ofertas · {len(household_ids)} hogares")

    print(f"Import completed: {imported} household-offer rows across {len(store_keys)} stores.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        print(f"HTTP error {exc.code}: {detail}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
