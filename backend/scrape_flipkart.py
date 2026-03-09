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

        # Title
        title = product.inner_text()

        # Link
        href = product.get_attribute("href")
        link = "https://www.flipkart.com" + href if href else None

        # Move to parent card
        card = product.locator("xpath=ancestor::div[1]")

        # Price
        price_el = card.locator("text=₹").first
        price = price_el.inner_text() if price_el.count() > 0 else None

        # Rating
        rating_el = card.locator("div:has-text('★')").first
        rating = rating_el.inner_text() if rating_el.count() > 0 else None

        print("TITLE:", title)
        print("LINK:", link)
        print("PRICE:", price)
        print("RATING:", rating)
        print("------------")

    browser.close()