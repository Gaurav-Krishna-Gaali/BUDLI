import json
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


def scrape_cashify_data(query: str, page_size: int = 20):
    """
    Fetch product data from Cashify's internal search API.

    Cashify is a Next.js/React app that calls its own REST API.
    We replicate those API calls directly — no browser / Playwright needed,
    making this server-friendly and lightweight.

    Strategy
    --------
    1. GET the search page to obtain a valid session cookie.
    2. Parse the JWT access_token from the ``_cs___oa__t___v1`` cookie.
    3. POST to the internal search endpoint with the Bearer token.

    Returns a list of dicts:
        {"name", "price", "original_price", "effective_price",
         "discount_pct", "rating", "storage", "image", "link"}
    """
    base_url = "https://www.cashify.in"
    search_page_url = f"{base_url}/buy-refurbished-gadgets/all-gadgets/search"
    api_url = f"{base_url}/api/omni01/product/catalogue/list/search/results"

    # Static device-id used by the web client (captured from browser network tab).
    DEVICE_ID = "cashify-QFKYSD-ZC00MJVHLTLHMJMTZJAZMJLKMGY3MTY1"

    session = requests.Session()
    session.headers.update(HEADERS)

    # Step 1: GET search page to populate session cookies (including auth token).
    session.get(search_page_url, params={"q": query}, timeout=30)

    # Step 2: Extract access token from the auth cookie.
    access_token: str | None = None
    raw_cookie = session.cookies.get("_cs___oa__t___v1")
    if raw_cookie:
        try:
            token_data = json.loads(raw_cookie)
            access_token = token_data.get("access_token")
        except (json.JSONDecodeError, AttributeError):
            pass

    # Step 3: POST to the internal search API.
    api_headers = {
        **HEADERS,
        "Content-Type": "application/json",
        "x-app-device-id": DEVICE_ID,
    }
    if access_token:
        api_headers["x-authorization"] = f"Bearer {access_token}"

    payload = {
        "qry": query,
        "ps": page_size,   # page size (number of results)
        "os": 1,            # offset / page number
        "sf": None,         # sort field
        "fr": {
            "product_type": [{"name": "product_type", "value": "Mobile Phone"}],
            "availability": [{"value": "In Stock"}],
        },
    }

    resp = session.post(api_url, json=payload, headers=api_headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Response: {"results": [...], "total": N, ...}
    items = data.get("results") or data.get("data", {}).get("results", [])

    products: list[dict] = []
    for item in items:
        name = item.get("product_name") or item.get("name")
        sale_price = item.get("sale_price")
        mrp = item.get("mrp")
        effective_price = item.get("effective_price")
        rating = item.get("ar") or item.get("rating")
        storage = item.get("storage")
        img = item.get("img_url") or item.get("image")
        slug = item.get("slug") or item.get("url_slug")
        link = f"{base_url}/buy-{slug}-refurbished" if slug else None

        # Format prices as ₹ strings to match other scrapers.
        def fmt(val):
            if val is None:
                return None
            try:
                return f"₹{int(float(val)):,}"
            except (ValueError, TypeError):
                return str(val)

        products.append(
            {
                "name": name,
                "price": fmt(sale_price),
                "original_price": fmt(mrp),
                "effective_price": fmt(effective_price),
                "discount_pct": (
                    f"-{round((1 - float(sale_price) / float(mrp)) * 100)}%"
                    if sale_price and mrp and float(mrp) > 0
                    else None
                ),
                "rating": str(rating) if rating else None,
                "storage": storage,
                "image": img,
                "link": link,
            }
        )

    return products



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
        print(
            f"- {product['name']} | {product['price']}"
            f" (was {product.get('original_price', 'N/A')}"
            f", {product.get('discount', 'N/A')})"
            f" | Rating: {product.get('rating', 'N/A')}"
            f" | {product.get('link', 'no link')}"
        )


if __name__ == "__main__":
    main()