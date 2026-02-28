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
        
        devices.append({
            "name": name,
            "price": price,
            "link": link,
        })
    
    return devices

def main():
    # Ensure ₹ prints correctly on Windows terminals.
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("Starting device scraping...")
    results = scrape_device_data("iphone 11")
    print(f"Found {len(results)} devices:")
    for device in results:
        print(f"- {device['name']} - {device['price']}")

if __name__ == "__main__":
    main()