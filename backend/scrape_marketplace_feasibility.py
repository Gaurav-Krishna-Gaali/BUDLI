"""
Feasibility script: scrape velocity data from Amazon & Flipkart via search.

WHERE THE DATA COMES FROM (on the live site):
  - Amazon: We load the search results page. "X+ bought in past month" is only
    taken from product cards whose title/link actually matches your search query
    (e.g. cards that mention "iPhone 12" when you search "refurbished iphone 12").
    If there are no matching cards, the list is empty (we do not use "bought"
    text from unrelated products).
  - Flipkart: We load the search results page (e.g. flipkart.com/search?q=...).
    The listing count (e.g. 1916) comes from the summary line Flipkart shows
    above the results, e.g. "of 1,916 results". The script finds that number
    by searching the whole page text for a pattern like "X results".

Requires: pip install playwright && playwright install chromium

Run from backend dir:
  python scrape_marketplace_feasibility.py
  python scrape_marketplace_feasibility.py --demo
  python scrape_marketplace_feasibility.py --amazon-query "refurbished iphone 12"
  python scrape_marketplace_feasibility.py --flipkart-query "refurbished iphone 12"
  python scrape_marketplace_feasibility.py --amazon-query "iphone 12" --flipkart-query "refurbished iphone 12"
"""

import argparse
import re
import sys
from urllib.parse import quote_plus

from bs4 import BeautifulSoup


def _fetch_html_playwright(url: str, timeout: float = 15000) -> str | None:
    """Fetch URL with Playwright. Returns None if Playwright not installed or on failure."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_extra_http_headers({"Accept-Language": "en-IN,en;q=0.9"})
        page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        page.wait_for_timeout(2000)
        html = page.content()
        browser.close()
    return html


def _soup(html: str):
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


# ---------------------------------------------------------------------------
# Amazon (search)
# ---------------------------------------------------------------------------

def _extract_bsr_from_html(soup: BeautifulSoup) -> str | None:
    """Try to find BSR on Amazon page (product or search)."""
    rank_pattern = re.compile(r"#[\d,]+(\s+in\s+[\w\s&]+)?", re.I)
    for tag in soup.select("span, div, td"):
        t = tag.get_text(strip=True)
        if not t or len(t) > 200:
            continue
        if "rank" in t.lower() or "bestseller" in t.lower():
            m = rank_pattern.search(t)
            if m:
                return m.group(0).strip()
    for script in soup.select("script:not([src])"):
        content = script.string or ""
        if "bestsellersRank" in content or "salesRank" in content:
            m = re.search(r"#(\d[\d,]*)\s*in\s*[^\"']+", content)
            if m:
                return f"#{m.group(1)} in (from script)"
            m = re.search(r"[\"']rank[\"']\s*:\s*(\d+)", content, re.I)
            if m:
                return f"#{m.group(1)} (from script)"
    return None


def _query_keywords(query: str) -> list[str]:
    """Product-identifying keywords only. Filter words like 'refurbished' are optional (card may not show them)."""
    stop = {"in", "the", "for", "and", "or", "a", "an"}
    # Treat "refurbished" as optional: Amazon often shows product name without it on the card
    optional_filter_words = {"refurbished", "renewed", "used"}
    words = re.split(r"\s+", query.lower().strip())
    return [w for w in words if w and w not in stop and w not in optional_filter_words]


def _card_contains_query(card_el, keywords: list[str]) -> bool:
    """True if the element's text contains all product keywords (e.g. iphone + 15)."""
    if not keywords:
        return True
    text = (card_el.get_text() or "").lower()
    return all(kw in text for kw in keywords)


def _find_card_for_text_node(soup: BeautifulSoup, el) -> BeautifulSoup | None:
    """Walk up from the element containing the text to find a product card (has /dp/ link)."""
    while el and el != soup and hasattr(el, "select_one"):
        if el.select_one('a[href*="/dp/"]'):
            return el
        el = el.parent if hasattr(el, "parent") else None
    return None


def _extract_bought_in_past_month(soup: BeautifulSoup, query: str) -> list[str]:
    """Only from product cards that match the search query (e.g. title contains 'iphone' and '12')."""
    found: list[str] = []
    keywords = _query_keywords(query)
    patterns = [
        re.compile(r"(\d+[\+]?\s*bought in (?:the )?past month)", re.I),
        re.compile(r"([\d,]+\+?\s*bought)", re.I),
    ]
    for tag in soup.find_all(string=True):
        if not isinstance(tag, str):
            continue
        s = tag.strip()
        if "bought" in s.lower() and ("month" in s.lower() or "past" in s.lower() or len(s) < 50):
            for pat in patterns:
                m = pat.search(s)
                if m:
                    val = m.group(1).strip()
                    if not val or val in found:
                        continue
                    # Only include if this text is inside a card that matches the query
                    parent = tag.parent if hasattr(tag, "parent") else None
                    if not parent:
                        continue
                    card = _find_card_for_text_node(soup, parent)
                    if card and _card_contains_query(card, keywords):
                        found.append(val)
                    break
    return found


def scrape_amazon_search(query: str) -> dict:
    """
    Search Amazon (amazon.in) for query and extract velocity-style data from results.

    Returns dict: bsr, bought_in_past_month (list), url, error.
    """
    result = {"bsr": None, "bought_in_past_month": [], "url": None, "error": None}
    url = f"https://www.amazon.in/s?k={quote_plus(query)}"
    result["url"] = url

    html = _fetch_html_playwright(url)
    if html is None:
        result["error"] = "Playwright required: pip install playwright && playwright install chromium"
        return result

    soup = _soup(html)
    result["bsr"] = _extract_bsr_from_html(soup)
    result["bought_in_past_month"] = _extract_bought_in_past_month(soup, query)
    return result


# ---------------------------------------------------------------------------
# Flipkart (search)
# ---------------------------------------------------------------------------

def scrape_flipkart_search(query: str) -> dict:
    """
    Search Flipkart for query and get listing count (and any results text).

    Returns dict: listing_count, results_text, url, error.
    """
    result = {"listing_count": None, "results_text": None, "url": None, "error": None}
    url = f"https://www.flipkart.com/search?q={quote_plus(query)}"
    result["url"] = url

    html = _fetch_html_playwright(url)
    if html is None:
        result["error"] = "Playwright required: pip install playwright && playwright install chromium"
        return result

    soup = _soup(html)
    text = soup.get_text()
    # Flipkart shows e.g. "of 1,916 results" above the product grid — we match that.
    m = re.search(r"(?:of\s+)?([\d,]+)\s*results?", text, re.I)
    if m:
        try:
            result["listing_count"] = int(m.group(1).replace(",", ""))
            result["results_text"] = m.group(0).strip()
        except ValueError:
            result["results_text"] = m.group(0).strip()

    if result["listing_count"] is None:
        seen = set()
        for a in soup.select("a[href*='/p/']"):
            href = a.get("href", "")
            if href and href not in seen and "/p/" in href:
                seen.add(href)
        if seen:
            result["listing_count"] = len(seen)
            result["results_text"] = f"~{len(seen)} product links (counted from page)"
    return result


# ---------------------------------------------------------------------------
# CLI & demo
# ---------------------------------------------------------------------------

def _ensure_utf8():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def run_demo():
    """Run feasibility check with example search queries."""
    _ensure_utf8()
    print("=" * 60)
    print("Marketplace scrape feasibility (Playwright only, search for both)")
    print("=" * 60)

    query = "refurbished iphone 12"
    print(f"\n--- Amazon search: {query!r} ---")
    amazon_result = scrape_amazon_search(query)
    if amazon_result["error"]:
        print(f"  Error: {amazon_result['error']}")
    else:
        print(f"  URL: {amazon_result['url']}")
        print(f"  BSR: {amazon_result['bsr'] or '(not found)'}")
        bought = amazon_result["bought_in_past_month"]
        print(f"  Bought in past month: {bought if bought else '(not found)'}")
    print()

    print(f"--- Flipkart search: {query!r} ---")
    flipkart_result = scrape_flipkart_search(query)
    if flipkart_result["error"]:
        print(f"  Error: {flipkart_result['error']}")
    else:
        print(f"  URL: {flipkart_result['url']}")
        print(f"  Listing count: {flipkart_result['listing_count'] or '(not found)'}")
        print(f"  Results text: {flipkart_result['results_text'] or '-'}")
    print()

    print("=" * 60)
    print("If data is (not found), selectors may need updating for current page layout.")
    print("=" * 60)


def main():
    _ensure_utf8()
    parser = argparse.ArgumentParser(
        description="Scrape Amazon & Flipkart velocity data via search (Playwright only)"
    )
    parser.add_argument("--amazon-query", type=str, help="Amazon.in search query")
    parser.add_argument("--flipkart-query", type=str, help="Flipkart search query")
    parser.add_argument("--demo", action="store_true", help="Run demo with example query")
    args = parser.parse_args()

    if args.demo or (not args.amazon_query and not args.flipkart_query):
        run_demo()
        return

    if args.amazon_query:
        print("Amazon:")
        r = scrape_amazon_search(args.amazon_query)
        print(f"  URL: {r['url']}")
        print(f"  BSR: {r['bsr']}")
        print(f"  Bought in past month: {r['bought_in_past_month']}")
        if r["error"]:
            print(f"  Error: {r['error']}")

    if args.flipkart_query:
        print("Flipkart:")
        r = scrape_flipkart_search(args.flipkart_query)
        print(f"  URL: {r['url']}")
        print(f"  Listing count: {r['listing_count']}")
        print(f"  Results text: {r['results_text']}")
        if r["error"]:
            print(f"  Error: {r['error']}")


if __name__ == "__main__":
    main()
