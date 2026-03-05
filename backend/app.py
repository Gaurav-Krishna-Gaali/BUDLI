from typing import Any, Literal, Optional

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

from bedrock_helper import analyze_with_bedrock
from script import scrape_device_data, scrape_refit_data, scrape_cashify_data

# Optional BrowserUse SDK for /scrape/start + /scrape/results/{job_id}
_browser_use_client: Any = None

def _get_browser_use_client():
    global _browser_use_client
    if _browser_use_client is None and os.environ.get("BROWSER_USE_API_KEY"):
        try:
            from browser_use_sdk import AsyncBrowserUse  # type: ignore[import-untyped]
            _browser_use_client = AsyncBrowserUse()
        except Exception:
            pass
    return _browser_use_client

# In-memory job store for browser scrape jobs (per process)
_browser_scrape_jobs: dict[str, dict[str, Any]] = {}


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


async def _run_browser_scrape_tasks(
    client: Any, prompts: list[str], session_ids: list[str]
) -> dict[str, list[BrowserScrapeDevice]]:
    """Run browser scrape for all sources; returns dict source -> list[BrowserScrapeDevice]."""
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
    Returns (devices, source_urls) in the same shape as _scrape_all_sources for feeding into Bedrock.
    Returns ([], []) if BrowserUse client is not available.
    """
    client = _get_browser_use_client()
    if not client:
        return [], []

    prompts = _browser_prompts_for_query(query)
    try:
        sessions = [await client.sessions.create() for _ in prompts]
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


@app.post("/scrape", response_model=ScrapeResponse)
def scrape(req: ScrapeRequest) -> ScrapeResponse:
    """Quick sync scrape (script-based, Ovantica only). For full browser scrape use POST /scrape/start."""
    try:
        devices = scrape_device_data(req.query)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scrape failed: {e}") from e

    return ScrapeResponse(query=req.query, count=len(devices), devices=devices)


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
    job_id = str(uuid.uuid4())
    sessions = []
    live_urls = []
    for _ in prompts:
        try:
            session = await client.sessions.create()
            sessions.append(session.id)
            live_urls.append(session.live_url)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to create browser session: {e}") from e
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
    """Scrape via browser (when BROWSER_USE_API_KEY set), else script; then run Bedrock analysis."""
    devices_dicts: list[dict] = []
    try:
        devices_dicts, _ = await _scrape_with_browser(req.query)
        if not devices_dicts:
            # Fallback: script-based (Ovantica only)
            raw = scrape_device_data(req.query)
            for d in raw:
                d = dict(d)
                d.setdefault("source", "ovantica")
                devices_dicts.append(d)
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
    velocity: str
    explanation: str
    risk_flags: list[str]
    confidence_score: Optional[int] = None
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


def _scrape_all_sources(search_query: str) -> tuple[list[dict], list[dict]]:
    """
    Scrape Ovantica, ReFit Global, and Cashify. Returns (devices, source_urls).
    Each device has name, price, link, source ("ovantica" | "refitglobal" | "cashify").
    source_urls is a list of {"source": str, "url": str}.
    """
    devices: list[dict] = []
    source_urls: list[dict] = []

    try:
        ovantica = scrape_device_data(search_query)
        for d in ovantica:
            d["source"] = "ovantica"
            devices.append(d)
        source_urls.append({
            "source": "ovantica",
            "url": f"https://ovantica.com/catalogsearch/result?q={urllib.parse.quote(search_query)}",
        })
    except Exception as e:
        logger.warning("Ovantica scrape failed: %s", e)

    try:
        refit = scrape_refit_data(search_query)
        for d in refit:
            d["source"] = "refitglobal"
            devices.append(d)
        source_urls.append({
            "source": "refitglobal",
            "url": f"https://refitglobal.com/search?q={urllib.parse.quote_plus(search_query)}",
        })
    except Exception as e:
        logger.warning("ReFit scrape failed: %s", e)

    try:
        cashify = scrape_cashify_data(search_query)
        for d in cashify:
            d["source"] = "cashify"
            devices.append(d)
        source_urls.append({
            "source": "cashify",
            "url": f"https://www.cashify.in/buy-refurbished-gadgets/all-gadgets/search?q={urllib.parse.quote_plus(search_query)}",
        })
    except Exception as e:
        logger.warning("Cashify scrape failed: %s", e)

    return devices, source_urls


async def _run_bedrock_analysis(
    idx: int,
    brand: str,
    model: str,
    storage_gb: str,
    ram_gb: str,
    network_type: str,
    condition_tier: str,
    warranty_months: str,
) -> tuple[Optional[str], Optional[str], Optional[str], list[str], Optional[int], str, list[dict]]:
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
        if not scraped_devices:
            scraped_devices, source_urls = _scrape_all_sources(search_query)
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
        return "", "", "", [], None, fallback_urls[0]["url"], fallback_urls

    # Build a structured pricing prompt and ask for JSON.
    instructions = (
        "You are Budli's Pricing Intelligence AI.\n\n"
        "You receive:\n"
        "- Device attributes (brand, model, storage, condition, warranty, RAM, network type)\n"
        "- External market signals from scraped listings (price, title, link, source) in JSON. "
        "Sources include 'ovantica', 'refitglobal' (ReFit Global), and 'cashify'. Use all when available.\n\n"
        "For the given device and signals, decide a competitive selling strategy.\n\n"
        "Return ONLY a JSON object with the following fields:\n\n"
        "1. recommended_price: number (in INR, no currency symbol, e.g. 28999)\n"
        "2. velocity: string (\"Very Good\" | \"Good\" | \"Neutral\" | \"Average\" | \"Slow\")\n"
        "3. explanation: string (2–4 sentences explaining the pricing decision)\n"
        "4. risk_flags: array of strings (e.g. [\"Below competitor floor\", \"Low demand\", \"Data sparse\"]).\n"
        "5. confidence_score: integer 0-100 reflecting how confident you are in this "
        "recommendation given the scraped data quality, listing density, and price spread. "
        "Use 90-100 for abundant, consistent data; 70-89 for moderate data; "
        "50-69 for sparse/conflicting data; below 50 for very limited data.\n\n"
        "Velocity: base it on scraped listing density, price spread, and how competitive the device is. "
        "Use \"Very Good\" or \"Good\" for strong demand signals (many listings, tight spread); "
        "\"Neutral\" or \"Average\" for moderate; \"Slow\" for sparse or wide-spread data.\n\n"
        "Pricing guidelines:\n"
        "- Start from the central tendency (median preferred) of scraped prices.\n"
        "- Adjust downward for worse condition or weaker warranty vs typical, upward for better.\n"
        "- For Very Good/Good velocity: price at or above market median to capture demand premium.\n"
        "- For Average/Slow velocity: price 5-10% below market median to accelerate inventory turnover.\n"
        "- Ensure recommended_price is not unreasonably far from both market average and lowest competitor unless clearly justified.\n"
    )

    try:
        logger.info("Row %d: sending %d scraped devices to Bedrock", idx, len(scraped_devices))
        analysis_text = analyze_with_bedrock(
            devices=[
                {
                    "name": d.get("name"),
                    "price": d.get("price"),
                    "link": d.get("link"),
                    "source": d.get("source", "unknown"),
                }
                for d in scraped_devices
            ],
            query=query_string,
            instructions=instructions,
            model_id=None,
            region=None,
            max_tokens=800,
            temperature=0.1,
        )
        predicted_price: Optional[str] = ""
        velocity: Optional[str] = ""
        explanation: Optional[str] = ""
        risk_flags: list[str] = []
        confidence_score: Optional[int] = None
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
            vel_value = parsed.get("velocity")
            explanation = parsed.get("explanation", "")
            risk_flags = parsed.get("risk_flags", [])
            confidence_score = parsed.get("confidence_score")
            
            if value is not None:
                predicted_price = str(value)
                logger.info("Row %d: predicted_price=%s", idx, predicted_price)
            if vel_value is not None:
                velocity = str(vel_value)
                logger.info("Row %d: velocity=%s", idx, velocity)
            else:
                logger.warning(
                    "Row %d: analysis JSON missing 'recommended_price' and/or 'velocity': %s",
                    idx,
                    analysis_text,
                )
        except Exception as parse_err:
            logger.warning(
                "Row %d: could not parse analysis as JSON (%s); raw text: %s",
                idx,
                parse_err,
                analysis_text,
            )
            predicted_price = ""
            velocity = ""

        primary_url = source_urls[0]["url"] if source_urls else ""
        return predicted_price, velocity, explanation, risk_flags, confidence_score, primary_url, source_urls
    except Exception as bedrock_err:
        logger.exception("Row %d: Bedrock analysis failed: %s", idx, bedrock_err)
        primary_url = source_urls[0]["url"] if source_urls else ""
        return "", "", "", [], None, primary_url, source_urls


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
    if "velocity" not in fieldnames:
        fieldnames.append("velocity")
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

        predicted_price, velocity, explanation, risk_flags, confidence_score, source_url, source_urls = await _run_bedrock_analysis(
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
        row["velocity"] = velocity
        row["source_url"] = source_url
        row["source_urls"] = json.dumps(source_urls) if source_urls else "[]"
        writer.writerow(row)

    output_buf.seek(0)
    return StreamingResponse(
        output_buf,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="analyzed.csv"'},
    )

@app.post("/analyze-devices", response_model=AnalyzeDevicesResponse)
async def analyze_devices(req: AnalyzeDevicesRequest) -> AnalyzeDevicesResponse:
    results = []
    for idx, d in enumerate(req.devices, start=1):
        price, vel, explanation, flags, confidence_score, source_url, source_urls = await _run_bedrock_analysis(
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
            velocity=vel or "",
            explanation=explanation or "",
            risk_flags=flags or [],
            confidence_score=confidence_score,
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

