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
        self.current: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
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
