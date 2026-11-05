from __future__ import annotations

import argparse
import datetime as dt
import os
import pathlib
import tarfile
import tempfile
import uuid

import polars as pl
import requests

REPO = "ruvelro/opencesta"
CHAIN = "mercadona"
ZONE = os.getenv("MERCADONA_ZONE", "vlc1")
USER_AGENT = "MiCompra-OpenCesta-Importer/1.0 (+https://github.com/ajatsoft-apps/Mi-Compra)"
BATCH_SIZE = 250
MINIMUM_ROWS = 500


def request_json(url: str) -> dict:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=45)
    response.raise_for_status()
    return response.json()


def latest_release() -> tuple[str, str, str | None, str]:
    release = request_json(f"https://api.github.com/repos/{REPO}/releases/latest")
    if release.get("draft") or not release.get("tag_name", "").startswith("prices-"):
        raise RuntimeError("La última release de OpenCesta no es un snapshot de precios.")
    assets = {item.get("name"): item for item in release.get("assets", [])}
    prices_asset = assets.get("prices.tar.gz")
    if not prices_asset:
        raise RuntimeError("La última release no contiene prices.tar.gz.")
    catalog_asset = assets.get("catalog-mercadona.parquet")
    catalog_url = catalog_asset["browser_download_url"] if catalog_asset else None
    return release["tag_name"], prices_asset["browser_download_url"], catalog_url, release["html_url"]


def download_file(url: str, destination: pathlib.Path) -> None:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=120, stream=True)
    response.raise_for_status()
    with destination.open("wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 256):
            if chunk:
                handle.write(chunk)


def safe_extract(archive_path: pathlib.Path, target: pathlib.Path) -> None:
    with tarfile.open(archive_path, "r:gz") as archive:
        archive.extractall(target, filter="data")


def latest_zone_snapshot(root: pathlib.Path) -> pathlib.Path:
    matches = []
    for path in root.rglob("prices.parquet"):
        parts = path.parts
        if f"chain={CHAIN}" not in parts or f"zone={ZONE}" not in parts:
            continue
        date_part = next((part.removeprefix("date=") for part in parts if part.startswith("date=")), None)
        if date_part:
            try:
                captured = dt.date.fromisoformat(date_part)
            except ValueError:
                continue
            matches.append((captured, path))
    if not matches:
        raise RuntimeError(f"La release no contiene precios de {CHAIN}/{ZONE}.")
    matches.sort(key=lambda item: item[0])
    return matches[-1][1]


def to_optional(value):
    if value is None:
        return None
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return None
    return value


def normalize_rows(frame: pl.DataFrame, catalog_frame: pl.DataFrame | None = None) -> tuple[str, list[dict]]:
    required = {"chain", "zone", "sku", "display_name", "unit_price", "captured_at"}
    missing = required.difference(frame.columns)
    if missing:
        raise RuntimeError(f"El Parquet ha cambiado de esquema; faltan columnas: {sorted(missing)}")
    if frame.height < MINIMUM_ROWS:
        raise RuntimeError(f"Snapshot incompleto: solo contiene {frame.height} productos.")

    captured_dates = frame.get_column("captured_at").drop_nulls().unique().to_list()
    if len(captured_dates) != 1:
        raise RuntimeError(f"El fichero contiene varias fechas de captura: {captured_dates}")
    captured_at = str(captured_dates[0])

    if catalog_frame is not None:
        catalog_required = {"chain", "sku", "ean", "brand", "origin", "packaging", "legal_name", "enriched_at"}
        if catalog_required.issubset(catalog_frame.columns):
            catalog_rows = (
                catalog_frame
                .filter(pl.col("chain") == CHAIN)
                .select(
                    "sku",
                    pl.col("ean").alias("catalog_ean"),
                    pl.col("brand").alias("catalog_brand"),
                    pl.col("origin").alias("catalog_origin"),
                    pl.col("packaging").alias("catalog_packaging"),
                    pl.col("legal_name").alias("catalog_legal_name"),
                    pl.col("enriched_at").alias("catalog_enriched_at"),
                )
            )
            frame = frame.join(catalog_rows, on="sku", how="left")
        else:
            raise RuntimeError("El catálogo enriquecido de OpenCesta ha cambiado de esquema.")

    rows = []
    for raw in frame.iter_rows(named=True):
        if raw["chain"] != CHAIN or raw["zone"] != ZONE:
            raise RuntimeError("El Parquet mezcla cadenas o zonas inesperadas.")
        rows.append({
            "chain": CHAIN,
            "zone": ZONE,
            "sku": str(raw["sku"]),
            "product_name": str(raw["display_name"]).strip(),
            "brand": to_optional(raw.get("brand")) or to_optional(raw.get("catalog_brand")),
            "ean": to_optional(raw.get("ean")) or to_optional(raw.get("catalog_ean")),
            "origin": to_optional(raw.get("catalog_origin")) or to_optional(raw.get("origin")),
            "packaging": to_optional(raw.get("catalog_packaging")),
            "legal_name": to_optional(raw.get("catalog_legal_name")),
            "enriched_at": to_optional(raw.get("catalog_enriched_at")),
            "category": str(raw.get("category") or ""),
            "subcategory": str(raw.get("subcategory") or ""),
            "unit_price": to_optional(raw.get("unit_price")),
            "reference_price": to_optional(raw.get("reference_price")),
            "reference_format": to_optional(raw.get("reference_format")),
            "unit_size": to_optional(raw.get("unit_size")),
            "size_format": to_optional(raw.get("size_format")),
            "tax_pct": to_optional(raw.get("tax_pct")),
            "is_pack": bool(raw.get("is_pack") or False),
            "is_discounted": bool(raw.get("is_discounted") or False),
            "product_url": to_optional(raw.get("url")),
            "thumbnail_url": to_optional(raw.get("thumbnail")),
            "captured_at": captured_at,
            "captured_at_ts": to_optional(raw.get("captured_at_ts")),
        })
    if len({row["sku"] for row in rows}) != len(rows):
        raise RuntimeError("El snapshot contiene SKU duplicados.")
    if any(not row["product_name"] or row["unit_price"] is None for row in rows):
        raise RuntimeError("Hay productos sin nombre o sin precio; se cancela la publicación.")
    return captured_at, rows


def supabase_request(method: str, path: str, key: str, payload=None, params=None, prefer=None):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    response = requests.request(
        method,
        f"{base}/rest/v1/{path}",
        headers=headers,
        params=params,
        json=payload,
        timeout=90,
    )
    if not response.ok:
        raise RuntimeError(f"Supabase {method} {path} respondió {response.status_code}: {response.text[:1200]}")
    return response


def import_snapshot(tag: str, release_url: str, captured_at: str, rows: list[dict], key: str) -> None:
    import_id = str(uuid.uuid4())
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start:start + BATCH_SIZE]
        supabase_request(
            "POST",
            "market_price_staging",
            key,
            payload=[{"import_id": import_id, **row} for row in batch],
            params={"on_conflict": "import_id,sku"},
            prefer="resolution=merge-duplicates,return=minimal",
        )
        print(f"Staging {min(start + len(batch), len(rows))}/{len(rows)}")

    result = supabase_request(
        "POST",
        "rpc/publish_market_price_snapshot",
        key,
        payload={
            "p_import_id": import_id,
            "p_source_revision": tag,
            "p_source_url": release_url,
            "p_chain": CHAIN,
            "p_zone": ZONE,
            "p_captured_at": captured_at,
            "p_expected_count": len(rows),
        },
    )
    print(f"Snapshot publicado: {result.text or 'OK'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa el snapshot diario de Mercadona desde OpenCesta.")
    parser.add_argument("--dry-run", action="store_true", help="Descarga y valida el Parquet sin modificar Supabase.")
    args = parser.parse_args()

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not args.dry_run and (not supabase_url or not service_key):
        raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.")

    tag, prices_url, catalog_url, release_url = latest_release()
    print(f"OpenCesta release: {tag}")
    with tempfile.TemporaryDirectory(prefix="mi-compra-opencesta-") as temporary:
        root = pathlib.Path(temporary)
        archive_path = root / "prices.tar.gz"
        download_file(prices_url, archive_path)
        extracted = root / "extracted"
        extracted.mkdir()
        safe_extract(archive_path, extracted)
        parquet_path = latest_zone_snapshot(extracted)
        frame = pl.read_parquet(parquet_path)
        catalog_frame = None
        if catalog_url:
            catalog_path = root / "catalog-mercadona.parquet"
            download_file(catalog_url, catalog_path)
            catalog_frame = pl.read_parquet(catalog_path)
        captured_at, rows = normalize_rows(frame, catalog_frame)
        enriched = sum(1 for row in rows if row["ean"] or row["brand"])
        print(f"Snapshot {CHAIN}/{ZONE} · {captured_at} · {len(rows)} productos · {enriched} con EAN/marca · validación correcta")
        if args.dry_run:
            print("Dry run: no se ha modificado Supabase.")
            return

        stale_before = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat()
        supabase_request("DELETE", "market_price_staging", service_key, params={"created_at": f"lt.{stale_before}"})
        import_snapshot(tag, release_url, captured_at, rows, service_key)


if __name__ == "__main__":
    main()
