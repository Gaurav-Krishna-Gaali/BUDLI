import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

def scrape_device_data(model_name):
    # This endpoint returns server-rendered product cards (no JS required).
    search_url = "https://ovantica.com/catalogsearch/result"
    response = requests.get(
        search_url,
        params={"q": model_name},
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()

    # Use lxml if installed; otherwise fall back to stdlib parser.
    try:
        soup = BeautifulSoup(response.text, "lxml")
    except Exception:
        soup = BeautifulSoup(response.text, "html.parser")
    
    devices = []
    
    # Cards look like:
    # <a class="group block" data-testid="product-card-1268" href="...">...</a>
    for card in soup.select("a[data-testid^=product-card-]"):
        name_el = card.select_one("h3")
        price_el = card.select_one("span[data-testid^=price-]")
        href = card.get("href")
        link = urljoin("https://ovantica.com", href) if href else None

        name = name_el.get_text(strip=True) if name_el else None
        price = price_el.get_text(strip=True) if price_el else None

        devices.append(
            {
                "name": name,
                "price": price,
                "link": link,
            }
        )

    return devices


def scrape_refit_data(query: str):
    """
    Scrape product data from ReFit Global search results.

    Returns a list of dicts: {"name", "price", "link"}.
    """
    search_url = "https://refitglobal.com/search"
    response = requests.get(
        search_url,
        params={"q": query},
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()

    try:
        soup = BeautifulSoup(response.text, "lxml")
    except Exception:
        soup = BeautifulSoup(response.text, "html.parser")

    products = []

    # Product cards in ReFit (Shopify/Dawn style).
    # Prefer list items, then explicit product card wrappers, then generic grid items.
    cards = (
        soup.select("li.grid__item")
        or soup.select("div.product-card-wrapper")
        or soup.select("div.grid__item")
    )

    base_url = "https://refitglobal.com"

    for card in cards:
        # Name: Shopify Dawn style product card.
        name_el = (
            card.select_one(".card__heading a")
            or card.select_one(".card__heading")
            or card.select_one("h3 a")
            or card.select_one("h3")
            or card.select_one("a[href*='/products/']")
        )

        # Price: prefer specific price-item nodes under .price.
        price_el = (
            card.select_one(".price .price-item--sale")
            or card.select_one(".price .price-item")
            or card.select_one(".price")
        )

        link_el = (
            card.select_one("a.card-wrapper[href*='/products/']")
            or card.select_one(".card__heading a[href*='/products/']")
            or card.select_one("a[href*='/products/']")
        )

        href = link_el.get("href") if link_el else None
        link = urljoin(base_url, href) if href else None

        name = name_el.get_text(strip=True) if name_el else None

        if hasattr(price_el, "get_text"):
            price = price_el.get_text(strip=True)
        else:
            price = str(price_el).strip() if price_el else None

        # Only include actual product cards: must have product link and price.
        if not link or "/products/" not in link or not price or "₹" not in price:
            continue

        products.append(
            {
                "name": name,
                "price": price,
                "link": link,
            }
        )

    return products


def scrape_cashify_data(query: str):
    """
    Scrape product data from Cashify search results.

    Returns a list of dicts: {"name", "price", "link"}.
    """
    search_url = "https://www.cashify.in/buy-refurbished-gadgets/all-gadgets/search"
    response = requests.get(
        search_url,
        params={"q": query},
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()

    try:
        soup = BeautifulSoup(response.text, "lxml")
    except Exception:
        soup = BeautifulSoup(response.text, "html.parser")

    base_url = "https://www.cashify.in"
    products: list[dict] = []

    # Cards are clickable anchors to /buy-...-refurbished or /buy-...-unboxed
    card_links = soup.select("a[href^='/buy-'][href*='-refurbished'], a[href^='/buy-'][href*='-unboxed']")

    for a in card_links:
        href = a.get("href")
        link = urljoin(base_url, href) if href else None

        name_el = a.select_one("h2")
        price_el = a.select_one("h3")

        name = name_el.get_text(strip=True) if name_el else None
        price = price_el.get_text(strip=True) if price_el else None

        if not link or not name or not price or "₹" not in price:
            continue

        products.append({"name": name, "price": price, "link": link})

    # Deduplicate by link (Cashify may repeat anchors in layout).
    seen = set()
    unique: list[dict] = []
    for p in products:
        key = p.get("link")
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(p)

    return unique


def main():
    # Ensure ₹ prints correctly on Windows terminals.
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("Starting device scraping...")

    print("=== Ovantica ===")
    ovantica_results = scrape_device_data("iphone 11")
    print(f"Found {len(ovantica_results)} devices:")
    for device in ovantica_results:
        print(f"- {device['name']} - {device['price']}")

    print("\n=== ReFit Global ===")
    refit_results = scrape_refit_data("apple iphone 13")
    print(f"Found {len(refit_results)} products:")
    for product in refit_results:
        print(f"- {product['name']} - {product['price']}")

    print("\n=== Cashify ===")
    cashify_results = scrape_cashify_data("apple iphone 12")
    print(f"Found {len(cashify_results)} products:")
    for product in cashify_results[:10]:
        print(f"- {product['name']} - {product['price']}")


if __name__ == "__main__":
    main()