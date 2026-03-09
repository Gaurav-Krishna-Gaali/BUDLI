from playwright.sync_api import sync_playwright

model = "iPhone 15 Pro Max"
model = "OnePlus Nord CE5"
ram = "8GB"
storage = "256GB"
color = "Blue"

query = f"{model} {ram} {storage} {color}"
base_url = "https://www.flipkart.com/search?q="
url = base_url + query.replace(" ", "%20")

print(url)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()

    page.goto(url, timeout=60000)
    page.wait_for_load_state("networkidle")

    # Find product links (stable pattern)
    products = page.locator("a[href*='/p/']")

    count = min(products.count(), 10)

    for i in range(count):
        product = products.nth(i)

        # Full text for this product link
        full_text = product.inner_text()
        lines = [l.strip() for l in full_text.splitlines() if l.strip()]
        print(f"lines: {lines}")

        # Pick a clean title line (skip utility lines like "Add to Compare", "Currently unavailable")
        title = None
        for line in lines:
            if line.lower() in ("add to compare", "currently unavailable"):
                continue
            title = line
            break

        # Rating line (contains "Ratings" / "ratings")
        rating = None
        for line in lines:
            if "ratings" in line.lower():
                rating = line
                break

        # Link
        href = product.get_attribute("href")
        link = "https://www.flipkart.com" + href if href else None

        # Move to parent card
        card = product.locator("xpath=ancestor::div[1]")

        # Price
        price_el = card.locator("text=₹").first
        price = price_el.inner_text() if price_el.count() > 0 else None

        print("TITLE:", title)
        print("LINK:", link)
        print("PRICE:", price)
        print("RATING:", rating)
        print("------------")

    browser.close()