import json
import os
from typing import Any, Dict, Optional

import boto3


def _extract_converse_text(resp: Dict[str, Any]) -> str:
    message = (resp.get("output") or {}).get("message") or {}
    content = message.get("content") or []
    texts = [c.get("text") for c in content if isinstance(c, dict) and c.get("text")]
    return "\n".join(texts).strip()


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
    Prefer the Bedrock Converse API when available.
    """
    model_id = model_id or os.getenv("BEDROCK_MODEL_ID") or os.getenv("AWS_BEDROCK_MODEL_ID")
    if not model_id:
        raise RuntimeError(
            "Missing Bedrock model id. Set BEDROCK_MODEL_ID (or pass model_id in request)."
        )

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

    # Standardized API across Bedrock-supported chat models (preferred).
    if hasattr(client, "converse"):
        resp = client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
        )
        text = _extract_converse_text(resp)
        if text:
            return text
        return json.dumps(resp, ensure_ascii=False)

    # Fallback for older botocore: use invoke_model with Anthropic-compatible payload.
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
        "Your installed boto3/botocore doesn't support Bedrock Converse, and the configured "
        "model_id isn't Anthropic. Upgrade boto3 or use an Anthropic model_id."
    )

