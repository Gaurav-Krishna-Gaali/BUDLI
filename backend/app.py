from typing import Any, Literal, Optional, List, Dict

import asyncio
import csv
import io
import json
import logging
import os
import urllib.parse
import uuid
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import engine, Base, get_db
from models import RunModel, KnowledgeBaseEntryModel
from pydantic import BaseModel, Field, field_validator, model_validator
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

from bedrock_helper import analyze_with_bedrock

# BrowserUse SDK for /scrape/start + /scrape/results/{job_id} (only scraper in use)
_browser_use_client: Any = None

def _get_browser_use_client():
    global _browser_use_client
    api_key = os.environ.get("BROWSER_USE_API_KEY")
    if _browser_use_client is None and api_key:
        try:
            from browser_use_sdk import AsyncBrowserUse  # type: ignore[import-untyped]
            _browser_use_client = AsyncBrowserUse()
        except Exception as e:
            logger.warning("BrowserUse client init failed (check SDK install / serverless compatibility): %s", e)
    return _browser_use_client

# In-memory job store for browser scrape jobs (per process)
_browser_scrape_jobs: dict[str, dict[str, Any]] = {}

# In-memory job store for async analyze-devices (job_id -> status, live_urls, results, scrape_results, error)
_analyze_devices_jobs: dict[str, dict[str, Any]] = {}


def _best_effort_utf8_stdio() -> None:
    # Avoid UnicodeEncodeError on Windows consoles when printing/logging ₹, etc.
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _load_env() -> None:
    # Load environment variables from a local .env file if present.
    # This lets you keep AWS keys and model ids out of code.
    try:
        load_dotenv()
    except Exception:
        # FastAPI should still start even if .env loading fails.
        pass


_load_env()
_best_effort_utf8_stdio()


app = FastAPI(title="BUDLI helper API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For dev. In prod, lock this to frontend domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables
Base.metadata.create_all(bind=engine)

# Add scrape_results column if missing (e.g. existing DBs created before this field)
def _ensure_scrape_results_column():
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS scrape_results JSONB DEFAULT '{}'"))
            conn.commit()
    except Exception as e:
        logger.warning("Could not add scrape_results column (may already exist): %s", e)

_ensure_scrape_results_column()

logger = logging.getLogger("budli-api")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

class ScrapeRequest(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Search query, e.g. 'iphone 13'",
    )


class Device(BaseModel):
    name: Optional[str] = None
    price: Optional[str] = None
    link: Optional[str] = None
    source: Optional[str] = None
    # Cashify-specific (also available for other sources if scrapers add them)
    original_price: Optional[str] = None
    effective_price: Optional[str] = None
    discount_pct: Optional[str] = None
    rating: Optional[str] = None
    storage: Optional[str] = None
    image: Optional[str] = None


class ScrapeResponse(BaseModel):
    query: str
    count: int
    devices: list[Device]


class VelocityScrapeRequest(BaseModel):
    model: str = Field(..., min_length=1, max_length=200)
    ram: str = Field(..., min_length=1, max_length=50)
    storage: str = Field(..., min_length=1, max_length=50)
    color: str = Field(..., min_length=1, max_length=50)
    limit: int = Field(5, ge=1, le=20)


class VelocityScrapeItem(BaseModel):
    title: Optional[str] = None
    link: Optional[str] = None
    rating: Optional[str] = None
    reviews: Optional[str] = None
    bought: Optional[str] = None


class VelocityScrapeResponse(BaseModel):
    query: dict
    results: List[VelocityScrapeItem]
    non_matching: List[VelocityScrapeItem]


class FlipkartScrapeItem(BaseModel):
    title: Optional[str] = None
    link: Optional[str] = None
    price: Optional[str] = None
    rating: Optional[str] = None


class FlipkartScrapeResponse(BaseModel):
    query: dict
    results: List[FlipkartScrapeItem]
    non_matching: List[FlipkartScrapeItem]


# --- BrowserUse scraper ---
class BrowserScrapeDevice(BaseModel):
    """Schema returned by BrowserUse per device."""
    Storage: str = ""
    Model: str = ""
    Ram: str = ""
    Color: str = ""
    Condition: str = ""
    Price: str = ""


class BrowserScrapeDevicesList(BaseModel):
    items: list[BrowserScrapeDevice]


def _browser_prompts_for_query(query: str) -> list[str]:
    """Build one prompt per source using the user's query."""
    return [
        f"Go to https://ovantica.com/ and find all the prices for second hand {query} with the different configs. Return a table of config and price and condition.",
        f"Go to https://refitglobal.com/ and find all the prices for second hand {query} with the different configs. Return a table of config and price and condition.",
        f"Go to https://www.cashify.in/ and find all the prices for second hand {query} with the different configs. Return a table of config and price and condition.",
    ]


def _browser_results_to_devices(results: dict[str, list[BrowserScrapeDevice]]) -> list[Device]:
    """Map BrowserUse results (per source) to app's Device list."""
    devices: list[Device] = []
    for source, items in results.items():
        for d in items or []:
            name = d.Model or f"{d.Storage} {d.Color}".strip() or None
            devices.append(
                Device(
                    name=name,
                    price=d.Price or None,
                    link=None,
                    source=source,
                    storage=d.Storage or None,
                )
            )
    return devices


async def _run_single_browser(client: Any, prompt: str, session_id: str) -> Any:
    result = await client.run(
        prompt,
        session_id=session_id,
        output_schema=BrowserScrapeDevicesList,
    )
    return result.output


_BROWSER_SOURCES = ["ovantica", "refitglobal", "cashify"]
# Single-device scrape uses exactly one session per source (3 total). Do not create more.
NUM_BROWSER_SESSIONS = 3


async def _run_browser_scrape_tasks(
    client: Any, prompts: list[str], session_ids: list[str]
) -> dict[str, list[BrowserScrapeDevice]]:
    """Run browser scrape for all sources; returns dict source -> list[BrowserScrapeDevice]."""
    # Use only first N sessions/prompts to avoid ever running more than NUM_BROWSER_SESSIONS.
    prompts = prompts[:NUM_BROWSER_SESSIONS]
    session_ids = session_ids[:NUM_BROWSER_SESSIONS]
    if len(session_ids) != NUM_BROWSER_SESSIONS:
        logger.warning(
            "Browser scrape: expected %d session ids, got %d; using %d",
            NUM_BROWSER_SESSIONS,
            len(session_ids),
            len(session_ids),
        )
    tasks = [
        asyncio.create_task(_run_single_browser(client, prompt, sid))
        for prompt, sid in zip(prompts, session_ids)
    ]
    results_list = await asyncio.gather(*tasks, return_exceptions=True)
    results: dict[str, list[BrowserScrapeDevice]] = {}
    for source, result in zip(_BROWSER_SOURCES, results_list):
        if isinstance(result, Exception):
            logger.warning("Browser scrape %s failed: %s", source, result)
            results[source] = []
        else:
            raw = getattr(result, "items", []) if result else []
            results[source] = [
                x if isinstance(x, BrowserScrapeDevice) else BrowserScrapeDevice(**(x or {}))
                for x in raw
            ]
    return results


async def _run_browser_scrape(job_id: str, prompts: list[str], session_ids: list[str]) -> None:
    client = _get_browser_use_client()
    if not client:
        _browser_scrape_jobs[job_id]["status"] = "error"
        _browser_scrape_jobs[job_id]["error"] = "BrowserUse client not available"
        return
    results = await _run_browser_scrape_tasks(client, prompts, session_ids)
    _browser_scrape_jobs[job_id]["results"] = results
    _browser_scrape_jobs[job_id]["status"] = "finished"


async def _scrape_with_browser(query: str) -> tuple[list[dict], list[dict]]:
    """
    Run browser-based scrape for all three sources (Ovantica, ReFit, Cashify).
    Returns (devices, source_urls) for feeding into Bedrock.
    Returns ([], []) if BrowserUse client is not available.
    """
    client = _get_browser_use_client()
    if not client:
        return [], []

    prompts = _browser_prompts_for_query(query)
    prompts = prompts[:NUM_BROWSER_SESSIONS]
    try:
        sessions = [await client.sessions.create() for _ in range(NUM_BROWSER_SESSIONS)]
    except Exception as e:
        logger.warning("Browser session create failed: %s", e)
        return [], []

    session_ids = [s.id for s in sessions]
    results = await _run_browser_scrape_tasks(client, prompts, session_ids)
    devices = _browser_results_to_devices(results)
    device_dicts = [d.model_dump() for d in devices]
    encoded = urllib.parse.quote_plus(query)
    source_urls = [
        {"source": "ovantica", "url": f"https://ovantica.com/catalogsearch/result?q={urllib.parse.quote(query)}"},
        {"source": "refitglobal", "url": f"https://refitglobal.com/search?q={encoded}"},
        {"source": "cashify", "url": f"https://www.cashify.in/buy-refurbished-gadgets/all-gadgets/search?q={encoded}"},
    ]
    return device_dicts, source_urls


class AnalyzeRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    instructions: Optional[str] = Field(
        default=None,
        description="Optional analysis instructions to guide the LLM.",
    )
    model_id: Optional[str] = Field(
        default=None,
        description="Optional Bedrock model id. If omitted, uses BEDROCK_MODEL_ID env var.",
    )
    region: Optional[str] = Field(
        default=None,
        description="Optional AWS region override. If omitted, uses BEDROCK_REGION/AWS_REGION.",
    )
    max_tokens: int = Field(default=800, ge=1, le=4000)
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)


class AnalyzeResponse(BaseModel):
    query: str
    count: int
    devices: list[Device]
    analysis: str


class BedrockTestResponse(BaseModel):
    ok: bool
    analysis: str


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True}


@app.post("/scrape/start")
async def scrape_start(req: ScrapeRequest) -> dict[str, Any]:
    """Start a browser-based scrape (BrowserUse). Returns job_id and live_urls to poll /scrape/results/{job_id}."""
    client = _get_browser_use_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Browser scraper not available. Set BROWSER_USE_API_KEY to enable.",
        )
    prompts = _browser_prompts_for_query(req.query)
    # Single-device scrape: exactly 3 sessions (one per source: Ovantica, ReFit, Cashify).
    prompts = prompts[:NUM_BROWSER_SESSIONS]
    job_id = str(uuid.uuid4())
    sessions: list[str] = []
    live_urls: list[str] = []
    for i in range(NUM_BROWSER_SESSIONS):
        try:
            session = await client.sessions.create()
            sessions.append(session.id)
            live_urls.append(session.live_url)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to create browser session: {e}") from e
    logger.info(
        "Scrape job %s: created exactly %d browser sessions (Ovantica, ReFit, Cashify)",
        job_id,
        len(sessions),
    )
    _browser_scrape_jobs[job_id] = {
        "status": "running",
        "results": None,
        "query": req.query,
    }
    asyncio.create_task(_run_browser_scrape(job_id, prompts, sessions))
    return {"job_id": job_id, "live_urls": live_urls, "query": req.query}


@app.get("/scrape/results/{job_id}")
async def scrape_results(job_id: str) -> dict[str, Any]:
    """Get status and results for a browser scrape job started via POST /scrape/start."""
    job = _browser_scrape_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    out = {"job_id": job_id, "status": job["status"], "query": job.get("query")}
    if job.get("error"):
        out["error"] = job["error"]
    if job.get("results") is not None:
        results = job["results"]
        devices = _browser_results_to_devices(results)
        out["results"] = results
        out["devices"] = [d.model_dump() for d in devices]
        out["count"] = len(devices)
    return out


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """Scrape via browser (BrowserUse); then run Bedrock analysis. Requires BROWSER_USE_API_KEY."""
    devices_dicts: list[dict] = []
    try:
        devices_dicts, _ = await _scrape_with_browser(req.query)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scrape failed: {e}") from e

    try:
        analysis = analyze_with_bedrock(
            devices=devices_dicts,
            query=req.query,
            instructions=req.instructions,
            model_id=req.model_id,
            region=req.region,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bedrock analysis failed: {e}") from e

    devices = [Device(**{k: v for k, v in d.items() if k in Device.model_fields}) for d in devices_dicts]
    return AnalyzeResponse(query=req.query, count=len(devices), devices=devices, analysis=analysis)


def _scrape_amazon_search(
    model: str,
    ram: str,
    storage: str,
    color: str,
    limit: int = 5,
) -> List[Dict[str, Optional[str]]]:
    query = f"{model} {ram} {storage} {color}"
    url = "https://www.amazon.in/s?k=" + query.replace(" ", "+")

    items: List[Dict[str, Optional[str]]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url)
        page.wait_for_selector("div[data-component-type='s-search-result']")

        results = page.query_selector_all("div[data-component-type='s-search-result']")

        for r in results[:limit]:
            # Amazon sometimes splits the title text across multiple elements.
            # First try to join the key spans, then fall back to full h2/link text.
            title_el_1 = r.query_selector("h2 span")
            title_el_2 = r.query_selector("a.a-link-normal h2 span")

            parts: list[str] = []
            if title_el_1:
                parts.append(title_el_1.inner_text())
            if title_el_2:
                parts.append(title_el_2.inner_text())

            title: Optional[str]
            if parts:
                title = " ".join(parts)
            else:
                full_h2 = r.query_selector("h2") or r.query_selector("a.a-link-normal")
                title = full_h2.inner_text() if full_h2 else None

            link_el = r.query_selector("a.a-link-normal")
            rating_el = r.query_selector("span.a-icon-alt")
            reviews_el = r.query_selector(".s-underline-text")
            bought_el = r.query_selector("span.a-size-base.a-color-secondary")

            href = link_el.get_attribute("href") if link_el else None
            link = "https://amazon.in" + href if href else None
            rating = rating_el.inner_text() if rating_el else None
            reviews = reviews_el.inner_text() if reviews_el else None
            bought = bought_el.inner_text() if bought_el else None

            items.append(
                {
                    "title": title,
                    "link": link,
                    "rating": rating,
                    "reviews": reviews,
                    "bought": bought,
                }
            )

        browser.close()

    return items


def _scrape_flipkart_search(
    model: str,
    ram: str,
    storage: str,
    color: str,
    limit: int = 10,
) -> List[Dict[str, Optional[str]]]:
    query = f"{model} {ram} {storage} {color}"
    base_url = "https://www.flipkart.com/search?q="
    url = base_url + query.replace(" ", "%20")

    items: List[Dict[str, Optional[str]]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, timeout=60000)
        page.wait_for_load_state("networkidle")

        products = page.locator("a[href*='/p/']")
        count = min(products.count(), limit)

        for i in range(count):
            product = products.nth(i)

            # Title
            title = product.inner_text() if product else None

            # Link
            href = product.get_attribute("href") if product else None
            link = "https://www.flipkart.com" + href if href else None

            # Move to parent card
            card = product.locator("xpath=ancestor::div[1]") if product else None

            # Price
            price = None
            rating = None
            if card:
                price_el = card.locator("text=₹").first
                if price_el.count() > 0:
                    price = price_el.inner_text()

                rating_el = card.locator("div:has-text('★')").first
                if rating_el.count() > 0:
                    rating = rating_el.inner_text()

            items.append(
                {
                    "title": title,
                    "link": link,
                    "price": price,
                    "rating": rating,
                }
            )

        browser.close()

    return items


@app.post("/velocity-scrape", response_model=VelocityScrapeResponse)
async def velocity_scrape(req: VelocityScrapeRequest) -> VelocityScrapeResponse:
    """
    Scrape Amazon.in search results for a given device config.

    This reuses the Playwright logic from the standalone script and wraps it
    in the main FastAPI app as /velocity-scrape.
    """
    loop = asyncio.get_running_loop()
    items_raw = await loop.run_in_executor(
        None,
        _scrape_amazon_search,
        req.model,
        req.ram,
        req.storage,
        req.color,
        req.limit,
    )

    # Send scraped items + a filtering query to Bedrock so it can
    # return only the items that best match the requested config.
    filter_query = (
        "Filter the following Amazon search results for devices.\n"
        "Return ONLY the items that clearly match this desired configuration:\n\n"
        f"- Model: {req.model}\n"
        f"- RAM: {req.ram}\n"
        f"- Storage: {req.storage}\n"
        f"- Color: {req.color}\n\n"
        "Devices are provided as a JSON array.\n"
        "Your response MUST be a JSON array of device objects using the same keys "
        "(`title`, `link`, `rating`, `reviews`, `bought`) and nothing else."
    )

    bedrock_text = analyze_with_bedrock(
        devices=items_raw,
        query=filter_query,
        instructions=(
            "You are a strict filter over a list of scraped marketplace items.\n"
            "Given a desired device configuration and a JSON array of items, "
            "you MUST respond ONLY with a JSON array of the items that best match "
            "the desired configuration.\n\n"
            f"Hard rule: the device title MUST contain the exact model string '{req.model}' "
            "in a case-insensitive way; if the title does not contain that exact substring, "
            "exclude the item.\n"
            "Soft rules: RAM, storage and color should match when possible, but if they "
            "are missing or differ slightly while the model title still matches, you may "
            "still include the item.\n"
            "Do not include any explanation text; return only raw JSON."
        ),
        max_tokens=800,
        temperature=0.0,
    )

    filtered_items: list[dict] = items_raw
    try:
        parsed = json.loads(bedrock_text)
        if isinstance(parsed, list):
            filtered_items = [x for x in parsed if isinstance(x, dict)]
    except Exception:
        # If Bedrock doesn't return valid JSON, fall back to unfiltered items.
        pass

    # Extra safety: enforce that title contains the exact model string.
    model_norm = (req.model or "").lower()
    if model_norm:
        filtered_items = [
            item
            for item in filtered_items
            if isinstance(item.get("title"), str) and model_norm in item["title"].lower()
        ]

    items = [VelocityScrapeItem(**item) for item in filtered_items]

    # Everything that was scraped but not returned in `results`
    matched_keys = {(i.title, i.link) for i in items}
    non_matching_raw = [
        item
        for item in items_raw
        if (item.get("title"), item.get("link")) not in matched_keys
    ]
    non_matching_items = [VelocityScrapeItem(**item) for item in non_matching_raw]

    return VelocityScrapeResponse(
        query={
            "model": req.model,
            "ram": req.ram,
            "storage": req.storage,
            "color": req.color,
            "limit": req.limit,
        },
        results=items,
        non_matching=non_matching_items,
    )


@app.post("/flipkart-scrape", response_model=FlipkartScrapeResponse)
async def flipkart_scrape(req: VelocityScrapeRequest) -> FlipkartScrapeResponse:
    """
    Scrape Flipkart search results for a given device config and filter with Bedrock.
    """
    loop = asyncio.get_running_loop()
    items_raw = await loop.run_in_executor(
        None,
        _scrape_flipkart_search,
        req.model,
        req.ram,
        req.storage,
        req.color,
        req.limit,
    )

    filter_query = (
        "Filter the following Flipkart search results for devices.\n"
        "Return ONLY the items that clearly match this desired configuration:\n\n"
        f"- Model: {req.model}\n"
        f"- RAM: {req.ram}\n"
        f"- Storage: {req.storage}\n"
        f"- Color: {req.color}\n\n"
        "Devices are provided as a JSON array.\n"
        "Your response MUST be a JSON array of device objects using the same keys "
        "(`title`, `link`, `price`, `rating`) and nothing else."
    )

    bedrock_text = analyze_with_bedrock(
        devices=items_raw,
        query=filter_query,
        instructions=(
            "You are a strict filter over a list of scraped marketplace items from Flipkart.\n"
            "Given a desired device configuration and a JSON array of items, "
            "you MUST respond ONLY with a JSON array of the items that best match "
            "the desired configuration.\n\n"
            f"Hard rule: the device title MUST contain the exact model string '{req.model}' "
            "in a case-insensitive way; if the title does not contain that exact substring, "
            "exclude the item.\n"
            "Soft rules: RAM, storage and color should match when possible, but if they "
            "are missing or differ slightly while the model title still matches, you may "
            "still include the item.\n"
            "Do not include any explanation text; return only raw JSON."
        ),
        max_tokens=800,
        temperature=0.0,
    )

    filtered_items: list[dict] = items_raw
    try:
        parsed = json.loads(bedrock_text)
        if isinstance(parsed, list):
            filtered_items = [x for x in parsed if isinstance(x, dict)]
    except Exception:
        # If Bedrock doesn't return valid JSON, fall back to unfiltered items.
        pass

    # Extra safety: enforce that title contains the exact model string.
    model_norm = (req.model or "").lower()
    if model_norm:
        filtered_items = [
            item
            for item in filtered_items
            if isinstance(item.get("title"), str) and model_norm in item["title"].lower()
        ]

    items = [FlipkartScrapeItem(**item) for item in filtered_items]

    matched_keys = {(i.title, i.link) for i in items}
    non_matching_raw = [
        item
        for item in items_raw
        if (item.get("title"), item.get("link")) not in matched_keys
    ]
    non_matching_items = [FlipkartScrapeItem(**item) for item in non_matching_raw]

    return FlipkartScrapeResponse(
        query={
            "model": req.model,
            "ram": req.ram,
            "storage": req.storage,
            "color": req.color,
            "limit": req.limit,
        },
        results=items,
        non_matching=non_matching_items,
    )


ALLOWED_NETWORK_TYPES = ("5G", "4G", "3G")
ALLOWED_CONDITION_TIERS = (
    "superb", "fair", "good",
    "Like New", "Excellent", "Good", "Fair",
)
WARRANTY_MONTHS_MIN = 0
WARRANTY_MONTHS_MAX = 24
ANALYZE_DEVICES_MAX_ITEMS = 50


class AnalyzeDevicesRequestItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    brand: str = Field(..., max_length=100)
    model: str = Field(..., min_length=1, max_length=200)
    storage_gb: str = Field(..., min_length=1, max_length=20)
    ram_gb: str = Field(..., min_length=1, max_length=20)
    network_type: str = Field(..., max_length=10)
    condition_tier: str = Field(..., min_length=1, max_length=20)
    warranty_months: str = Field(..., max_length=5)

    @field_validator("network_type")
    @classmethod
    def network_type_allowed(cls, v: str) -> str:
        val = (v or "").strip()
        if val and val not in ALLOWED_NETWORK_TYPES:
            raise ValueError(f"network_type must be one of {ALLOWED_NETWORK_TYPES}")
        return val or "4G"

    @field_validator("condition_tier")
    @classmethod
    def condition_tier_allowed(cls, v: str) -> str:
        val = (v or "").strip()
        if not val:
            raise ValueError("condition_tier is required")
        if val not in ALLOWED_CONDITION_TIERS:
            raise ValueError(f"condition_tier must be one of {ALLOWED_CONDITION_TIERS}")
        return val

    @field_validator("warranty_months")
    @classmethod
    def warranty_months_in_range(cls, v: str) -> str:
        val = (v or "0").strip()
        try:
            n = int(val)
        except ValueError:
            raise ValueError("warranty_months must be a number")
        if not (WARRANTY_MONTHS_MIN <= n <= WARRANTY_MONTHS_MAX):
            raise ValueError(f"warranty_months must be between {WARRANTY_MONTHS_MIN} and {WARRANTY_MONTHS_MAX}")
        return val

class SourceUrl(BaseModel):
    source: str  # "ovantica" | "refitglobal" | "cashify"
    url: str


class AnalyzeDevicesResponseItem(BaseModel):
    id: str
    predicted_price: str
    explanation: str
    risk_flags: list[str]
    data_found_in: list[str] = []  # e.g. ["Ovantica", "ReFit Global", "Cashify"] — sources that had scraped listings
    source_url: str  # backward compat: primary URL
    source_urls: list[SourceUrl] = []  # all scraped source URLs

class AnalyzeDevicesRequest(BaseModel):
    devices: list[AnalyzeDevicesRequestItem] = Field(
        ...,
        min_length=1,
        max_length=ANALYZE_DEVICES_MAX_ITEMS,
        description="List of devices to analyze (1–50 items)",
    )

class AnalyzeDevicesResponse(BaseModel):
    results: list[AnalyzeDevicesResponseItem]


@app.post("/bedrock-test", response_model=BedrockTestResponse)
def bedrock_test(req: AnalyzeRequest) -> BedrockTestResponse:
    """
    Lightweight connectivity test against the configured Bedrock model.

    Use a strong reasoning Claude model, for example:
    - anthropic.claude-3-sonnet-20240229-v1:0

    Either:
    - set BEDROCK_MODEL_ID to that value, or
    - pass model_id in the request body.
    """
    try:
        analysis = analyze_with_bedrock(
            devices=[],
            query="Bedrock connectivity test",
            instructions=req.instructions
            or "Reply with a short sentence confirming that you are reachable.",
            model_id=req.model_id,
            region=req.region,
            max_tokens=min(req.max_tokens, 128),
            temperature=req.temperature,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bedrock test failed: {e}") from e

    return BedrockTestResponse(ok=True, analysis=analysis)


async def _run_bedrock_analysis(
    idx: int,
    brand: str,
    model: str,
    storage_gb: str,
    ram_gb: str,
    network_type: str,
    condition_tier: str,
    warranty_months: str,
) -> tuple[Optional[str], Optional[str], list[str], str, list[dict], list[str]]:
    query_string = (
        "Device Input:\n"
        f"Brand: {brand}\n"
        f"Model: {model}\n"
        f"Storage: {storage_gb}GB\n"
        f"RAM: {ram_gb}GB\n"
        f"Network: {network_type}\n"
        f"Condition: {condition_tier}\n"
        f"Warranty: {warranty_months} months\n"
    )

    # Keep search broad to get more samples: brand + model only.
    search_query = " ".join(x for x in [brand, model] if x)
    
    logger.info(
        "Row %d: querying '%s' (brand=%s, model=%s, storage=%sGB)",
        idx,
        search_query,
        brand,
        model,
        storage_gb,
    )

    try:
        scraped_devices, source_urls = await _scrape_with_browser(search_query)
        ovantica_count = sum(1 for d in scraped_devices if d.get("source") == "ovantica")
        refit_count = sum(1 for d in scraped_devices if d.get("source") == "refitglobal")
        cashify_count = sum(1 for d in scraped_devices if d.get("source") == "cashify")
        logger.info(
            "Row %d: scraped %d from Ovantica, %d from ReFit, %d from Cashify",
            idx, ovantica_count, refit_count, cashify_count,
        )
    except Exception as e:
        logger.exception("Row %d: scrape failed: %s", idx, e)
        fallback_urls = [
            {"source": "ovantica", "url": f"https://ovantica.com/catalogsearch/result?q={urllib.parse.quote(search_query)}"},
            {"source": "refitglobal", "url": f"https://refitglobal.com/search?q={urllib.parse.quote_plus(search_query)}"},
            {"source": "cashify", "url": f"https://www.cashify.in/buy-refurbished-gadgets/all-gadgets/search?q={urllib.parse.quote_plus(search_query)}"},
        ]
        return "", "", [], fallback_urls[0]["url"], fallback_urls, []

    # Which sources had data (for user-facing message)
    _SOURCE_LABELS = {"ovantica": "Ovantica", "refitglobal": "ReFit Global", "cashify": "Cashify"}
    sources_with_data = [
        _SOURCE_LABELS.get(s, s) for s in sorted(set(d.get("source") for d in scraped_devices if d.get("source")))
    ]

    # Build a structured pricing prompt: map device to scraped data and recommend price.
    instructions = (
        "You are Budli's Pricing Intelligence AI.\n\n"
        "You receive:\n"
        "- Device attributes (brand, model, storage, condition, warranty, RAM, network type)\n"
        "- Scraped listings (price, title, link, source) from Ovantica, ReFit Global, and/or Cashify.\n\n"
        "Exactly map the device to the scraped data. Do NOT use medians, means, or averages.\n\n"
        "Return ONLY a JSON object with these fields:\n\n"
        "1. recommended_price: number or null. Use the price from a matching scraped listing when you find one (same/similar config). If no listing matches the device, set recommended_price to null.\n"
        "2. explanation: string. When you have a match, briefly state which listing(s) you used. When there is no matching scraped data, set explanation to exactly: \"No data found.\"\n"
        "3. risk_flags: array of strings (e.g. [\"No matching config\", \"Data sparse\"]). Include \"No matching data\" when recommended_price is null.\n\n"
        "Rules:\n"
        "- Only recommend a price that comes directly from a scraped listing that matches (or closely matches) the device.\n"
        "- If no scraped listing matches the device, set recommended_price to null and explanation to \"No data found.\"\n"
    )

    try:
        # Pass full listing dicts to Bedrock (include all keys: name, price, source, storage, etc.)
        logger.info("Row %d: sending %d scraped devices to Bedrock", idx, len(scraped_devices))
        analysis_text = analyze_with_bedrock(
            devices=[{**d, "source": d.get("source", "unknown")} for d in scraped_devices],
            query=query_string,
            instructions=instructions,
            model_id=None,
            region=None,
            max_tokens=800,
            temperature=0.1,
        )
        predicted_price: Optional[str] = ""
        explanation: Optional[str] = ""
        risk_flags: list[str] = []
        try:
            # Strip markdown code fences if present (e.g. ```json ... ```)
            text = analysis_text.strip()
            if text.startswith("```"):
                lines = text.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                text = "\n".join(lines)
            parsed = json.loads(text)
            value = parsed.get("recommended_price")
            explanation = parsed.get("explanation", "")
            risk_flags = parsed.get("risk_flags", [])
            if value is not None:
                predicted_price = str(value)
                logger.info("Row %d: predicted_price=%s", idx, predicted_price)
            else:
                logger.warning("Row %d: analysis JSON missing 'recommended_price': %s", idx, analysis_text)
        except Exception as parse_err:
            logger.warning(
                "Row %d: could not parse analysis as JSON (%s); raw text: %s",
                idx,
                parse_err,
                analysis_text,
            )
            predicted_price = ""

        primary_url = source_urls[0]["url"] if source_urls else ""
        return predicted_price, explanation, risk_flags, primary_url, source_urls, sources_with_data
    except Exception as bedrock_err:
        logger.exception("Row %d: Bedrock analysis failed: %s", idx, bedrock_err)
        primary_url = source_urls[0]["url"] if source_urls else ""
        return "", "", [], primary_url, source_urls, []


def _run_bedrock_only(
    idx: int,
    query_string: str,
    scraped_devices: list[dict],
    source_urls: list[dict],
) -> tuple[Optional[str], Optional[str], list[str], str, list[dict], list[str]]:
    """Run only the Bedrock analysis step using pre-scraped devices and source_urls.
    scraped_devices: list of listing dicts (full table: Storage, Model, Ram, Color, Condition, Price, source)."""
    _SOURCE_LABELS = {"ovantica": "Ovantica", "refitglobal": "ReFit Global", "cashify": "Cashify"}
    sources_with_data = [
        _SOURCE_LABELS.get(s, s) for s in sorted(set(d.get("source") for d in scraped_devices if d.get("source")))
    ]
    instructions = (
        "You are Budli's Pricing Intelligence AI.\n\n"
        "You receive:\n"
        "- Device attributes (brand, model, storage, condition, warranty, RAM, network type)\n"
        "- Scraped listings from Ovantica, ReFit Global, and/or Cashify. Each listing has: Storage, Model, Ram, Color, Condition, Price, source. Match the device to listings by config (storage, model, ram, color, condition).\n\n"
        "Exactly map the device to the scraped data. Do NOT use medians, means, or averages.\n\n"
        "Return ONLY a JSON object with these fields:\n\n"
        "1. recommended_price: number or null. Use the price from a matching scraped listing when you find one (same/similar config). If no listing matches the device, set recommended_price to null.\n"
        "2. explanation: string. When you have a match, briefly state which listing(s) you used. When there is no matching scraped data, set explanation to exactly: \"No data found.\"\n"
        "3. risk_flags: array of strings (e.g. [\"No matching config\", \"Data sparse\"]). Include \"No matching data\" when recommended_price is null.\n\n"
        "Rules:\n"
        "- Only recommend a price that comes directly from a scraped listing that matches (or closely matches) the device.\n"
        "- If no scraped listing matches the device, set recommended_price to null and explanation to \"No data found.\"\n"
    )
    try:
        # Pass full scraped table to Bedrock so it can match by Storage, Model, Ram, Color, Condition, Price, source
        analysis_text = analyze_with_bedrock(
            devices=scraped_devices,
            query=query_string,
            instructions=instructions,
            model_id=None,
            region=None,
            max_tokens=800,
            temperature=0.1,
        )
        predicted_price: Optional[str] = ""
        explanation: Optional[str] = ""
        risk_flags: list[str] = []
        try:
            text = analysis_text.strip()
            if text.startswith("```"):
                lines = text.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                text = "\n".join(lines)
            parsed = json.loads(text)
            value = parsed.get("recommended_price")
            explanation = parsed.get("explanation", "")
            risk_flags = parsed.get("risk_flags", [])
            if value is not None:
                predicted_price = str(value)
        except Exception:
            pass
        primary_url = source_urls[0]["url"] if source_urls else ""
        return predicted_price or "", explanation or "", risk_flags, primary_url, source_urls, sources_with_data
    except Exception as e:
        logger.exception("Row %d: Bedrock analysis failed: %s", idx, e)
        primary_url = source_urls[0]["url"] if source_urls else ""
        return "", "", [], primary_url, source_urls, []


async def _run_analyze_devices_job(job_id: str, devices: list[AnalyzeDevicesRequestItem]) -> None:
    """Background task: scrape per device (each has 3 sessions), merge results, then Bedrock per device; store results."""
    job = _analyze_devices_jobs.get(job_id)
    if not job or job.get("status") != "running":
        return
    client = _get_browser_use_client()
    if not client:
        job["status"] = "error"
        job["error"] = "BrowserUse client not available"
        return
    session_ids_by_device = job.get("session_ids_by_device", [])
    if len(session_ids_by_device) != len(devices):
        job["status"] = "error"
        job["error"] = "Session count does not match device count"
        return
    # Run scrape for all devices in parallel so each device's sessions get used immediately (iframes stay live).
    merged_results: dict[str, list[BrowserScrapeDevice]] = {src: [] for src in _BROWSER_SOURCES}

    async def scrape_one_device(dev_idx: int, d: AnalyzeDevicesRequestItem) -> dict[str, list[BrowserScrapeDevice]]:
        session_ids = session_ids_by_device[dev_idx]
        if len(session_ids) != NUM_BROWSER_SESSIONS:
            raise ValueError(f"Device {dev_idx + 1}: expected {NUM_BROWSER_SESSIONS} session ids")
        query = " ".join(x for x in [d.brand, d.model] if x)
        prompts = _browser_prompts_for_query(query)
        return await _run_browser_scrape_tasks(client, prompts, session_ids)

    try:
        device_tasks = [scrape_one_device(dev_idx, d) for dev_idx, d in enumerate(devices)]
        device_results_list = await asyncio.gather(*device_tasks, return_exceptions=True)
        for dev_idx, result in enumerate(device_results_list):
            if isinstance(result, Exception):
                logger.exception("Analyze-devices job %s device %d scrape failed: %s", job_id, dev_idx + 1, result)
                job["status"] = "error"
                job["error"] = f"Device {dev_idx + 1} scrape failed: {result}"
                return
            for src in _BROWSER_SOURCES:
                merged_results[src].extend(result.get(src) or [])
    except Exception as e:
        logger.exception("Analyze-devices job %s scrape failed: %s", job_id, e)
        job["status"] = "error"
        job["error"] = str(e)
        return
    # Per-source results for frontend tables (ovantica, refitglobal, cashify -> list of dicts)
    scrape_results = {}
    for src in _BROWSER_SOURCES:
        items = merged_results.get(src) or []
        scrape_results[src] = [x.model_dump() if hasattr(x, "model_dump") else (x if isinstance(x, dict) else {}) for x in items]

    job["scrape_results"] = scrape_results

    # Full scraped table for Bedrock: each row has Storage, Model, Ram, Color, Condition, Price, source
    scraped_for_bedrock = []
    for src in _BROWSER_SOURCES:
        for x in merged_results.get(src) or []:
            row = x.model_dump() if hasattr(x, "model_dump") else (x if isinstance(x, dict) else {})
            if isinstance(row, dict):
                row = dict(row)
                row["source"] = src
            scraped_for_bedrock.append(row)

    results = []
    for idx, d in enumerate(devices, start=1):
        query_string = (
            f"Device Input:\nBrand: {d.brand}\nModel: {d.model}\nStorage: {d.storage_gb}GB\n"
            f"RAM: {d.ram_gb}GB\nNetwork: {d.network_type}\nCondition: {d.condition_tier}\nWarranty: {d.warranty_months} months\n"
        )
        encoded = urllib.parse.quote_plus(" ".join(x for x in [d.brand, d.model] if x))
        device_source_urls = [
            {"source": "ovantica", "url": f"https://ovantica.com/catalogsearch/result?q={urllib.parse.quote(d.model)}"},
            {"source": "refitglobal", "url": f"https://refitglobal.com/search?q={encoded}"},
            {"source": "cashify", "url": f"https://www.cashify.in/buy-refurbished-gadgets/all-gadgets/search?q={encoded}"},
        ]
        price, explanation, flags, source_url, surl_list, data_found_in = _run_bedrock_only(
            idx, query_string, scraped_for_bedrock, device_source_urls
        )
        results.append(AnalyzeDevicesResponseItem(
            id=d.id,
            predicted_price=price or "",
            explanation=explanation or "",
            risk_flags=flags or [],
            data_found_in=data_found_in or [],
            source_url=source_url or "",
            source_urls=[SourceUrl(**u) for u in surl_list] if surl_list else [],
        ))
    job["results"] = [r.model_dump() for r in results]
    job["status"] = "finished"


@app.post(
    "/analyze-csv",
    response_class=StreamingResponse,
    summary="Upload CSV and get back CSV with predicted_price column",
)
async def analyze_csv(file: UploadFile = File(...)) -> StreamingResponse:
    """
    Accepts a CSV with at least these columns:
    - brand, model, storage_gb, ram_gb, network_type, condition_tier, warranty_months

    For each row:
    - Scrapes external prices using `<brand> <model> <storage_gb>GB` as query
    - Calls Bedrock with a structured prompt to get a recommended price
    - Appends a `predicted_price` column

    Returns a CSV (text/csv) with the original columns plus `predicted_price`.
    """
    try:
        content = await file.read()
        text = content.decode("utf-8")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read CSV file: {e}") from e

    logger.info("Received CSV file '%s' (%d bytes)", file.filename, len(text.encode("utf-8")))

    input_buf = io.StringIO(text)
    reader = csv.DictReader(input_buf)

    fieldnames = reader.fieldnames or []
    if not fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row.")

    # Ensure output columns exist.
    if "predicted_price" not in fieldnames:
        fieldnames.append("predicted_price")
    if "data_found_in" not in fieldnames:
        fieldnames.append("data_found_in")
    if "source_url" not in fieldnames:
        fieldnames.append("source_url")
    if "source_urls" not in fieldnames:
        fieldnames.append("source_urls")

    output_buf = io.StringIO()
    writer = csv.DictWriter(output_buf, fieldnames=fieldnames)
    writer.writeheader()

    for idx, row in enumerate(reader, start=1):
        brand = (row.get("brand") or "").strip()
        model = (row.get("model") or "").strip()
        storage_gb = (row.get("storage_gb") or "").strip()
        ram_gb = (row.get("ram_gb") or "").strip()
        network_type = (row.get("network_type") or "").strip()
        condition_tier = (row.get("condition_tier") or "").strip()
        warranty_months = (row.get("warranty_months") or "").strip()

        predicted_price, explanation, risk_flags, source_url, source_urls, data_found_in = await _run_bedrock_analysis(
            idx,
            brand,
            model,
            storage_gb,
            ram_gb,
            network_type,
            condition_tier,
            warranty_months,
        )

        row["predicted_price"] = predicted_price
        row["data_found_in"] = ", ".join(data_found_in) if data_found_in else "—"
        row["source_url"] = source_url
        row["source_urls"] = json.dumps(source_urls) if source_urls else "[]"
        writer.writerow(row)

    output_buf.seek(0)
    return StreamingResponse(
        output_buf,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="analyzed.csv"'},
    )

@app.post("/analyze-devices/start")
async def analyze_devices_start(req: AnalyzeDevicesRequest) -> dict[str, Any]:
    """Start an async analyze-devices job. Returns job_id and live_urls_by_device (3 URLs per device). Poll GET /analyze-devices/status/{job_id} for results."""
    client = _get_browser_use_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Browser scraper not available. Set BROWSER_USE_API_KEY to enable.",
        )
    job_id = str(uuid.uuid4())
    session_ids_by_device: list[list[str]] = []
    live_urls_by_device: list[list[str]] = []
    for _ in req.devices:
        device_session_ids = []
        device_live_urls = []
        for _ in range(NUM_BROWSER_SESSIONS):
            try:
                session = await client.sessions.create()
                device_session_ids.append(session.id)
                device_live_urls.append(session.live_url)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Failed to create browser session: {e}") from e
        session_ids_by_device.append(device_session_ids)
        live_urls_by_device.append(device_live_urls)
    _analyze_devices_jobs[job_id] = {
        "status": "running",
        "live_urls_by_device": live_urls_by_device,
        "session_ids_by_device": session_ids_by_device,
        "results": None,
        "scrape_results": None,
        "error": None,
    }
    asyncio.create_task(_run_analyze_devices_job(job_id, req.devices))
    return {"job_id": job_id, "live_urls_by_device": live_urls_by_device}


@app.get("/analyze-devices/status/{job_id}")
async def analyze_devices_status(job_id: str) -> dict[str, Any]:
    """Get status of an analyze-devices job. When status is 'finished', includes results and scrape_results (3 tables by source)."""
    job = _analyze_devices_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    out = {"job_id": job_id, "status": job["status"]}
    if job.get("live_urls_by_device"):
        out["live_urls_by_device"] = job["live_urls_by_device"]
    if job.get("error"):
        out["error"] = job["error"]
    if job.get("results") is not None:
        out["results"] = job["results"]
    if job.get("scrape_results") is not None:
        out["scrape_results"] = job["scrape_results"]
    return out


@app.post("/analyze-devices", response_model=AnalyzeDevicesResponse)
async def analyze_devices(req: AnalyzeDevicesRequest) -> AnalyzeDevicesResponse:
    results = []
    for idx, d in enumerate(req.devices, start=1):
        price, explanation, flags, source_url, source_urls, data_found_in = await _run_bedrock_analysis(
            idx,
            d.brand,
            d.model,
            d.storage_gb,
            d.ram_gb,
            d.network_type,
            d.condition_tier,
            d.warranty_months,
        )
        results.append(AnalyzeDevicesResponseItem(
            id=d.id,
            predicted_price=price or "",
            explanation=explanation or "",
            risk_flags=flags or [],
            data_found_in=data_found_in or [],
            source_url=source_url or "",
            source_urls=[SourceUrl(**u) for u in source_urls] if source_urls else [],
        ))
        
    return AnalyzeDevicesResponse(results=results)

# --- Database Endpoints ---

class RunCreate(BaseModel):
    id: str
    name: str
    status: str
    createdAt: str = Field(alias="createdAt")
    completedAt: Optional[str] = Field(None, alias="completedAt")
    devices: list[dict]
    results: list[dict]
    scrapeResults: Optional[dict] = Field(None, alias="scrapeResults")  # Per-source tables: ovantica, refitglobal, cashify
    feedbackSubmitted: bool = Field(alias="feedbackSubmitted")

@app.get("/runs")
def get_runs(db: Session = Depends(get_db)):
    runs = db.query(RunModel).order_by(RunModel.created_at.desc()).all()
    # convert SQLAlchemy objects to dicts
    return [{
        "id": r.id,
        "name": r.name,
        "status": r.status,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
        "completedAt": r.completed_at.isoformat() if r.completed_at else None,
        "devices": r.devices,
        "results": r.results,
        "scrapeResults": r.scrape_results if r.scrape_results else None,
        "feedbackSubmitted": r.feedback_submitted
    } for r in runs]

@app.get("/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(RunModel).filter(RunModel.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {
        "id": run.id,
        "name": run.name,
        "status": run.status,
        "createdAt": run.created_at.isoformat() if run.created_at else None,
        "completedAt": run.completed_at.isoformat() if run.completed_at else None,
        "devices": run.devices,
        "results": run.results,
        "scrapeResults": run.scrape_results if run.scrape_results else None,
        "feedbackSubmitted": run.feedback_submitted
    }

@app.post("/runs")
def create_run(run: RunCreate, db: Session = Depends(get_db)):
    existing = db.query(RunModel).filter(RunModel.id == run.id).first()
    if existing:
        existing.name = run.name
        existing.status = run.status
        if run.completedAt:
            existing.completed_at = datetime.fromisoformat(run.completedAt.replace('Z', '+00:00'))
        existing.devices = run.devices
        existing.results = run.results
        if run.scrapeResults is not None:
            existing.scrape_results = run.scrapeResults
        existing.feedback_submitted = run.feedbackSubmitted
    else:
        new_run = RunModel(
            id=run.id,
            name=run.name,
            status=run.status,
            created_at=datetime.fromisoformat(run.createdAt.replace('Z', '+00:00')) if run.createdAt else None,
            completed_at=datetime.fromisoformat(run.completedAt.replace('Z', '+00:00')) if run.completedAt else None,
            devices=run.devices,
            results=run.results,
            scrape_results=run.scrapeResults if run.scrapeResults else None,
            feedback_submitted=run.feedbackSubmitted
        )
        db.add(new_run)
    db.commit()
    return {"status": "ok"}

@app.delete("/runs/{run_id}")
def delete_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(RunModel).filter(RunModel.id == run_id).first()
    if run:
        db.delete(run)
        db.commit()
    return {"status": "ok"}


class KBEntryCreate(BaseModel):
    id: str
    brand: str
    model: str
    ram: str
    storage: str
    conditionTier: str = Field(alias="conditionTier")
    recommendedPrice: int = Field(alias="recommendedPrice")
    humanApprovedPrice: int = Field(alias="humanApprovedPrice")
    delta: int
    velocityCategory: str = Field(alias="velocityCategory")
    humanVelocityOverride: Optional[str] = Field(None, alias="humanVelocityOverride")
    feedbackNote: Optional[str] = Field(None, alias="feedbackNote")
    runId: str = Field(alias="runId")
    createdAt: str = Field(alias="createdAt")

@app.get("/kb")
def get_kb_entries(db: Session = Depends(get_db)):
    entries = db.query(KnowledgeBaseEntryModel).order_by(KnowledgeBaseEntryModel.created_at.desc()).all()
    return [{
        "id": e.id,
        "brand": e.brand,
        "model": e.model,
        "ram": e.ram,
        "storage": e.storage,
        "conditionTier": e.condition_tier,
        "recommendedPrice": e.recommended_price,
        "humanApprovedPrice": e.human_approved_price,
        "delta": e.delta,
        "velocityCategory": e.velocity_category,
        "humanVelocityOverride": e.human_velocity_override,
        "feedbackNote": e.feedback_note,
        "runId": e.run_id,
        "createdAt": e.created_at.isoformat() if e.created_at else None
    } for e in entries]

@app.post("/kb")
def create_kb_entries(entries: list[KBEntryCreate], db: Session = Depends(get_db)):
    for e in entries:
        existing = db.query(KnowledgeBaseEntryModel).filter(KnowledgeBaseEntryModel.id == e.id).first()
        if not existing:
            new_entry = KnowledgeBaseEntryModel(
                id=e.id,
                brand=e.brand,
                model=e.model,
                ram=e.ram,
                storage=e.storage,
                condition_tier=e.conditionTier,
                recommended_price=e.recommendedPrice,
                human_approved_price=e.humanApprovedPrice,
                delta=e.delta,
                velocity_category=e.velocityCategory,
                human_velocity_override=e.humanVelocityOverride,
                feedback_note=e.feedbackNote,
                run_id=e.runId,
                created_at=datetime.fromisoformat(e.createdAt.replace('Z', '+00:00')) if e.createdAt else None
            )
            db.add(new_entry)
    db.commit()
    return {"status": "ok", "added": len(entries)}

