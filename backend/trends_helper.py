import os
from statistics import mean
from typing import Any, Dict, List, Optional

from serpapi import GoogleSearch


def _get_env_api_key() -> Optional[str]:
    key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    return key or None


def fetch_trend_metrics(query: str) -> Dict[str, Any]:
    """
    Fetches Google Trends metrics for a query via SerpAPI.

    Returns a dict with:
    - latest: int (0-100)
    - overall_avg: float
    - recent_avg: float (last 4 points or fewer)
    - direction: "increasing" | "flat" | "decreasing"
    - raw_points: list[int]

    If SERPAPI_API_KEY is not set or data is missing, returns {}.
    """
    api_key = _get_env_api_key()
    if not api_key:
        return {}

    params = {
        "api_key": api_key,
        "engine": "google_trends",
        "q": query,
        "data_type": "TIMESERIES",
        "date": "today 12-m",
    }

    search = GoogleSearch(params)
    results = search.get_dict()

    interest = (results.get("interest_over_time") or {}).get("timeline_data") or []
    values: List[int] = []
    for point in interest:
        for v in point.get("values", []):
            try:
                values.append(int(v.get("extracted_value")))
            except Exception:
                continue

    if not values:
        return {}

    latest = values[-1]
    overall_avg = float(mean(values))
    tail = values[-4:] if len(values) >= 4 else values
    recent_avg = float(mean(tail))

    # Simple direction heuristic based on recent vs overall average.
    if recent_avg > overall_avg * 1.1:
        direction = "increasing"
    elif recent_avg < overall_avg * 0.9:
        direction = "decreasing"
    else:
        direction = "flat"

    return {
        "latest": latest,
        "overall_avg": overall_avg,
        "recent_avg": recent_avg,
        "direction": direction,
        "raw_points": values,
    }

