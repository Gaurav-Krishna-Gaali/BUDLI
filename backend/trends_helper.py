"""
trends_helper.py  –  Google Trends → Demand Signal Model

Architecture
------------
Raw Google Trends time-series (0-100)
    ↓
3 demand sub-signals
    ↓
Demand Index  (0-1, normalised)
    ↓
Bedrock / Price Optimisation Model

Sub-signals
-----------
1. Recent Momentum   – mean of last 4 weeks
2. Growth Rate       – (last_4_week_avg - prev_4_week_avg) / prev_4_week_avg
3. Acceleration      – linear slope of last 8-12 data points (normalised)

Demand Index formula
--------------------
Demand_Index = 0.60 * recent_momentum
             + 0.30 * growth_rate_scaled   (clamped to [0, 1])
             + 0.10 * acceleration_scaled  (clamped to [0, 1])

All three components are normalised to [0, 1] before weighting.
"""

import os
from statistics import mean, stdev
from typing import Any, Dict, List, Optional

from serpapi.google_search import GoogleSearch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_env_api_key() -> Optional[str]:
    key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    return key or None


def _linear_slope(values: List[float]) -> float:
    """Return the least-squares slope of equally-spaced values."""
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = mean(values)
    numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    return numerator / denominator if denominator else 0.0


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_trend_metrics(query: str) -> Dict[str, Any]:
    """
    Fetch Google Trends data for *query* and return a rich demand-signal dict.

    Returned keys
    -------------
    raw_points          : list[int]   – raw 0-100 series (weekly, last 12 months)
    latest              : int         – most-recent value
    recent_4w_avg       : float       – mean of last 4 data points
    prev_4w_avg         : float       – mean of 4 data points before that
    growth_rate         : float       – (recent - prev) / prev  (can be negative)
    acceleration        : float       – slope of the last 8-12 points
    demand_index        : float       – composite [0-1] demand score
    demand_label        : str         – "Very High" | "High" | "Medium" | "Low" | "Very Low"
    direction           : str         – "increasing" | "flat" | "decreasing"

    Returns {} when the API key is missing or no data is returned.
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

    # ── 1. Recent Momentum ────────────────────────────────────────────────
    tail_4 = values[-4:] if len(values) >= 4 else values
    recent_4w_avg = float(mean(tail_4))
    # Normalise to [0, 1] (Trends values are already 0-100)
    momentum_scaled = recent_4w_avg / 100.0

    # ── 2. Growth Rate ────────────────────────────────────────────────────
    prev_window = values[-8:-4] if len(values) >= 8 else (values[:-4] if len(values) > 4 else values[:1])
    prev_4w_avg = float(mean(prev_window)) if prev_window else recent_4w_avg

    if prev_4w_avg > 0:
        growth_rate = (recent_4w_avg - prev_4w_avg) / prev_4w_avg
    else:
        growth_rate = 0.0

    # Scale growth rate: -100% → 0, 0% → 0.5, +100% → 1  (clamped)
    growth_rate_scaled = _clamp(0.5 + growth_rate * 0.5)

    # ── 3. Acceleration (slope of last 8-12 points) ───────────────────────
    accel_window = values[-12:] if len(values) >= 12 else (values[-8:] if len(values) >= 8 else values)
    slope = _linear_slope([float(v) for v in accel_window])
    # Typical weekly max change is ~10 pts/week; map slope to [0, 1] via sigmoid-like clamp.
    # slope = 0 → 0.5, slope = +10 → ~1.0, slope = -10 → ~0.0
    acceleration_scaled = _clamp(0.5 + slope / 20.0)

    # ── Composite Demand Index ─────────────────────────────────────────────
    demand_index = (
        0.60 * momentum_scaled
        + 0.30 * growth_rate_scaled
        + 0.10 * acceleration_scaled
    )
    demand_index = _clamp(demand_index)

    # Human-readable label
    if demand_index >= 0.75:
        demand_label = "Very High"
        direction = "increasing"
    elif demand_index >= 0.55:
        demand_label = "High"
        direction = "increasing"
    elif demand_index >= 0.40:
        demand_label = "Medium"
        direction = "flat"
    elif demand_index >= 0.25:
        demand_label = "Low"
        direction = "decreasing"
    else:
        demand_label = "Very Low"
        direction = "decreasing"

    # Refine direction if growth is strongly positive regardless of index bucket
    if growth_rate > 0.15 and direction != "increasing":
        direction = "increasing"
    elif growth_rate < -0.15 and direction != "decreasing":
        direction = "decreasing"

    return {
        "raw_points": values,
        "latest": values[-1],
        "recent_4w_avg": round(recent_4w_avg, 2),
        "prev_4w_avg": round(prev_4w_avg, 2),
        "growth_rate": round(growth_rate, 4),
        "acceleration": round(slope, 4),
        "demand_index": round(demand_index, 4),
        "demand_label": demand_label,
        "direction": direction,
        # Kept for backwards compatibility
        "recent_avg": round(recent_4w_avg, 2),
        "overall_avg": round(float(mean(values)), 2),
    }
