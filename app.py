from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from bedrock_helper import analyze_with_bedrock
from script import scrape_device_data


def _best_effort_utf8_stdio() -> None:
    # Avoid UnicodeEncodeError on Windows consoles when printing/logging ₹, etc.
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


_best_effort_utf8_stdio()


app = FastAPI(title="BUDLI helper API", version="0.1.0")


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

