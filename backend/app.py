from typing import Any, Optional

import csv
import os
import io
import json
import logging
import urllib.parse
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import engine, Base, get_db
from models import RunModel, KnowledgeBaseEntryModel
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from bedrock_helper import analyze_with_bedrock
from script import scrape_device_data
from trends_helper import fetch_trend_metrics


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
    query: str = Field(..., min_length=1, description="Search query, e.g. 'iphone 13'")


class Device(BaseModel):
    name: Optional[str] = None
    price: Optional[str] = None
    link: Optional[str] = None


class ScrapeResponse(BaseModel):
    query: str
    count: int
    devices: list[Device]


class AnalyzeRequest(BaseModel):
    query: str = Field(..., min_length=1)
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


class CsvAnalyzeResponseMeta(BaseModel):
    rows: int
    failed_rows: int


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True}


@app.post("/scrape", response_model=ScrapeResponse)
def scrape(req: ScrapeRequest) -> ScrapeResponse:
    try:
        devices = scrape_device_data(req.query)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scrape failed: {e}") from e

    return ScrapeResponse(query=req.query, count=len(devices), devices=devices)


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    try:
        devices = scrape_device_data(req.query)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scrape failed: {e}") from e

    try:
        analysis = analyze_with_bedrock(
            devices=devices,
            query=req.query,
            instructions=req.instructions,
            model_id=req.model_id,
            region=req.region,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bedrock analysis failed: {e}") from e

    return AnalyzeResponse(query=req.query, count=len(devices), devices=devices, analysis=analysis)


class AnalyzeDevicesRequestItem(BaseModel):
    id: str
    brand: str
    model: str
    storage_gb: str
    ram_gb: str
    network_type: str
    condition_tier: str
    warranty_months: str

class AnalyzeDevicesResponseItem(BaseModel):
    id: str
    predicted_price: str
    velocity: str
    explanation: str
    risk_flags: list[str]
    source_url: str

class AnalyzeDevicesRequest(BaseModel):
    devices: list[AnalyzeDevicesRequestItem]

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


def _run_bedrock_analysis(
    idx: int,
    brand: str,
    model: str,
    storage_gb: str,
    ram_gb: str,
    network_type: str,
    condition_tier: str,
    warranty_months: str,
) -> tuple[Optional[str], Optional[str], Optional[str], list[str], str]:
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

    # Simple search query for Ovantica and Google Trends.
    search_query = " ".join(x for x in [brand, model, f"{storage_gb}GB"] if x)
    search_url = f"https://ovantica.com/catalogsearch/result?q={urllib.parse.quote(search_query)}"
    
    logger.info(
        "Row %d: querying '%s' (brand=%s, model=%s, storage=%sGB)",
        idx,
        search_query,
        brand,
        model,
        storage_gb,
    )

    try:
        scraped_devices = scrape_device_data(search_query)
        logger.info(
            "Row %d: scraped %d devices from Ovantica", idx, len(scraped_devices)
        )

        # Fetch Google Trends metrics (best-effort, optional).
        trends = fetch_trend_metrics(search_query)
        if trends:
            logger.info(
                "Row %d: Google Trends latest=%s recent_avg=%.2f overall_avg=%.2f direction=%s",
                idx,
                trends.get("latest"),
                trends.get("recent_avg"),
                trends.get("overall_avg"),
                trends.get("direction"),
            )
            trends_summary = (
                f"Google Trends (normalized 0-100) for '{search_query}': "
                f"latest={trends.get('latest')}, "
                f"recent_avg={trends.get('recent_avg')}, "
                f"overall_avg={trends.get('overall_avg')}, "
                f"direction={trends.get('direction')}."
            )
        else:
            trends_summary = "Google Trends data unavailable."
            logger.info("Row %d: no Google Trends data", idx)
    except Exception as e:
        logger.exception("Row %d: scrape failed: %s", idx, e)
        # On scrape failure, leave model-driven fields empty but keep the row.
        return "", "", "", [], search_url

    # Build a structured pricing prompt and ask for JSON.
    instructions = (
        "You are Budli's Pricing Intelligence AI.\n\n"
        "You receive:\n"
        "- Device attributes (brand, model, storage, condition, warranty, RAM, network type)\n"
        "- External market signals from scraped listings (price and title list in JSON).\n"
        "- Search demand signals from Google Trends (normalized 0-100 indices over the last 12 months).\n\n"
        "For the given device and signals, decide a competitive selling strategy.\n\n"
        "Return ONLY a JSON object with the following fields:\n\n"
        "1. recommended_price: number (in INR, no currency symbol, e.g. 28999)\n"
        "2. velocity: string (\"Very Good\" | \"Good\" | \"Neutral\" | \"Average\" | \"Slow\")\n"
        "3. explanation: string (2–4 sentences explaining the pricing decision)\n"
        "4. risk_flags: array of strings (e.g. [\"Below competitor floor\", \"Low demand\", \"Data sparse\"]).\n\n"
        "Velocity classification guidelines:\n"
        "- Very Good: High demand signal (Google Trends recent_avg > 75, or many scraped listings with upward trend)\n"
        "- Good: Above-average demand (Google Trends recent_avg 55-75, or solid scraped data showing interest)\n"
        "- Neutral: Balanced demand (Google Trends recent_avg 40-55, or stable market conditions)\n"
        "- Average: Below-average demand (Google Trends recent_avg 25-40, or sparse scraped data)\n"
        "- Slow: Very low demand (Google Trends recent_avg < 25, or minimal scraped listings, downward trend)\n\n"
        "Pricing guidelines:\n"
        "- Start from the central tendency of scraped prices.\n"
        "- Adjust downward for worse condition or weaker warranty vs typical, upward for better.\n"
        "- For Very Good/Good velocity: price more aggressively at or above market average. For Average/Slow: price conservatively below average to move inventory faster.\n"
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
                }
                for d in scraped_devices
            ],
            query=query_string + "\n\n" + trends_summary,
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
        try:
            parsed = json.loads(analysis_text)
            value = parsed.get("recommended_price")
            vel_value = parsed.get("velocity")
            explanation = parsed.get("explanation", "")
            risk_flags = parsed.get("risk_flags", [])
            
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

        return predicted_price, velocity, explanation, risk_flags, search_url
    except Exception as bedrock_err:
        logger.exception("Row %d: Bedrock analysis failed: %s", idx, bedrock_err)
        return "", "", "", [], search_url


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

        predicted_price, velocity, explanation, risk_flags, source_url = _run_bedrock_analysis(
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
        writer.writerow(row)

    output_buf.seek(0)
    return StreamingResponse(
        output_buf,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="analyzed.csv"'},
    )

@app.post("/analyze-devices", response_model=AnalyzeDevicesResponse)
def analyze_devices(req: AnalyzeDevicesRequest) -> AnalyzeDevicesResponse:
    results = []
    for idx, d in enumerate(req.devices, start=1):
        price, vel, explanation, flags, source_url = _run_bedrock_analysis(
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
            source_url=source_url or ""
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

