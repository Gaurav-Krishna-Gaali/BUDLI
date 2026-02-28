import json
import os
from typing import Any, Dict, Optional

import boto3


def analyze_with_bedrock(
    *,
    devices: list[dict],
    query: str,
    instructions: Optional[str] = None,
    model_id: Optional[str] = None,
    region: Optional[str] = None,
    max_tokens: int = 800,
    temperature: float = 0.2,
) -> str:
    """
    Runs a short analysis of the scraped devices using AWS Bedrock.

    Credentials/region are resolved by boto3 (env vars, config files, IAM role, etc.).
    This implementation always uses invoke_model (no Converse API), as requested.
    """
    # Treat Swagger's default "string" as unset.
    if model_id == "string":
        model_id = None

    model_id = model_id or os.getenv("BEDROCK_MODEL_ID") or os.getenv("AWS_BEDROCK_MODEL_ID")
    if not model_id:
        raise RuntimeError(
            "Missing Bedrock model id. Set BEDROCK_MODEL_ID (or pass model_id in request)."
        )

    if region == "string":
        region = None

    region = region or os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION") or "us-east-1"

    system_prompt = (
        instructions
        or "You are a pricing analyst. Given a list of refurbished devices with prices, "
        "summarize the results, identify the best value options, and note any anomalies."
    )

    prompt = (
        "Query:\n"
        f"{query}\n\n"
        "Devices (JSON):\n"
        f"{json.dumps(devices, ensure_ascii=False)}\n\n"
        "Return a concise analysis in bullet points."
    )

    client = boto3.client("bedrock-runtime", region_name=region)

    # Use invoke_model with an Anthropic-compatible payload for Claude models.
    if model_id.startswith("anthropic."):
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system_prompt,
            "messages": [{"role": "user", "content": prompt}],
        }
        resp = client.invoke_model(
            modelId=model_id,
            body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            contentType="application/json",
            accept="application/json",
        )
        raw = resp["body"].read()
        data = json.loads(raw)
        # Anthropic responses typically contain: {"content":[{"type":"text","text":"..."}], ...}
        content = data.get("content") or []
        if content and isinstance(content, list) and isinstance(content[0], dict):
            text = content[0].get("text")
            if text:
                return str(text).strip()
        return json.dumps(data, ensure_ascii=False)

    raise RuntimeError(
        "This helper currently supports only Anthropic Claude models on Bedrock. "
        "Set BEDROCK_MODEL_ID to an anthropic.* model id, e.g. "
        "'anthropic.claude-3-sonnet-20240229-v1:0'."
    )

