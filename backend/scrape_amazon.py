"""
Amazon.in search results scraper using requests + BeautifulSoup.
Note: Amazon may serve different HTML or a captcha for non-browser requests.
If you get no results, the page might be JS-rendered — use the Playwright path in app.py.
"""
import requests
from bs4 import BeautifulSoup

# Same selectors as Playwright version (search results page)
MODEL = "iPhone 15 Pro Max"
RAM = "8GB"
STORAGE = "256GB"
COLOR = "Blue"

QUERY = f"{MODEL} {RAM} {STORAGE} {COLOR}"
URL = "https://www.amazon.in/s?k=" + QUERY.replace(" ", "+")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

def _text(el):
    if el is None:
        return None
    t = el.get_text(strip=True)
    return t if t else None

def _attr(el, name, default=None):
    if el is None:
        return default
    return el.get(name, default)

def main():
    print(URL)
    res = requests.get(URL, headers=HEADERS, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")

    # Search result cards (same data-component-type as Playwright)
    results = soup.select("div[data-component-type='s-search-result']")
    for r in results[:5]:
        # Title: join h2 span and a.a-link-normal h2 span
        title_el_1 = r.select_one("h2 span")
        title_el_2 = r.select_one("a.a-link-normal h2 span")
        parts = []
        if title_el_1:
            parts.append(_text(title_el_1))
        if title_el_2 and _text(title_el_2):
            parts.append(_text(title_el_2))
        title = " ".join(parts) if parts else None
        if not title and (title_el_1 or title_el_2):
            title = _text(title_el_1 or title_el_2)
        if not title:
            h2 = r.select_one("h2") or r.select_one("a.a-link-normal")
            title = _text(h2) if h2 else None

        link_el = r.select_one("a.a-link-normal[href*='/dp/'], a.a-link-normal[href*='/gp/product/']")
        if not link_el:
            link_el = r.select_one("a.a-link-normal")
        href = _attr(link_el, "href") if link_el else None
        link = ("https://www.amazon.in" + href) if href and href.startswith("/") else href

        rating_el = r.select_one("span.a-icon-alt")
        reviews_el = r.select_one(".s-underline-text")
        bought_el = r.select_one("span.a-size-base.a-color-secondary")

        rating = _text(rating_el)
        reviews = _text(reviews_el)
        bought = _text(bought_el)

        print("TITLE:", title)
        print("LINK:", link)
        print("RATING:", rating)
        print("REVIEWS:", reviews)
        print("BOUGHT:", bought)
        print("------------")

if __name__ == "__main__":
    main()
