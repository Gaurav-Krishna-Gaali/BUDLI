# import requests
# from bs4 import BeautifulSoup

# # url = "https://www.amazon.in/OnePlus-Nord-CE5-Nexus-Blue/dp/B0FCMK41N9/"
# url = "https://www.amazon.in/OnePlus-Nord-MediaTek-Dimensity-Infinity/dp/B0FCMKNCJ4"

# headers = {
#     "User-Agent": "Mozilla/5.0",
#     "Accept-Language": "en-US,en;q=0.9"
# }

# res = requests.get(url, headers=headers)
# soup = BeautifulSoup(res.text, "html.parser")

# # product title
# title = soup.select_one("#productTitle")
# product_name = title.get_text(strip=True) if title else None

# # bought in past month
# bought = soup.select_one("#social-proofing-faceout-title-tk_bought")
# bought_text = bought.get_text(strip=True) if bought else None

# print(product_name)
# print(bought_text)

from playwright.sync_api import sync_playwright


model = "iPhone 15 Pro Max"
ram = "8GB"
storage = "256GB"
color = "Blue"

query = f"{model} {ram} {storage} {color}"
url = "https://www.amazon.in/s?k=" + query.replace(" ", "+")
print(url)

with sync_playwright() as p:

    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto(url)
    page.wait_for_selector("div[data-component-type='s-search-result']")

    results = page.query_selector_all("div[data-component-type='s-search-result']")

    for r in results[:5]:

        # title_el =  r.query_selector("h2 span") + r.query_selector("a.a-link-normal h2 span")
        title_el_1 = r.query_selector("h2 span")
        title_el_2 = r.query_selector("a.a-link-normal h2 span")

        parts = []
        if title_el_1:
            parts.append(title_el_1.inner_text())
        if title_el_2:
            parts.append(title_el_2.inner_text())

        title = " ".join(parts) if parts else None

        link_el = r.query_selector("a.a-link-normal")

        rating_el = r.query_selector("span.a-icon-alt")
        reviews_el = r.query_selector(".s-underline-text")

        bought_el = r.query_selector(
            "span.a-size-base.a-color-secondary"
        )

        # title = title_el.inner_text() if title_el else None
        link = "https://amazon.in" + link_el.get_attribute("href") if link_el else None
        rating = rating_el.inner_text() if rating_el else None
        reviews = reviews_el.inner_text() if reviews_el else None
        bought = bought_el.inner_text() if bought_el else None

        print("TITLE:", title)
        print("LINK:", link)
        print("RATING:", rating)
        print("REVIEWS:", reviews)
        print("BOUGHT:", bought)
        print("------------")

    browser.close()