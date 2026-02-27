# BUDLI helper API

Small FastAPI server that:
- scrapes Ovantica results (title + price)
- optionally runs an AWS Bedrock analysis over the scraped data

## Setup

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn server:app --reload --port 8000
```

Open docs at `http://127.0.0.1:8000/docs`.

## Endpoints

- `GET /health`
- `POST /scrape`

Example body:

```json
{ "query": "iphone 13" }
```

- `POST /analyze`

Requires AWS credentials configured for Bedrock + a model id.

Environment variables:
- `BEDROCK_MODEL_ID`: e.g. `anthropic.claude-3-haiku-20240307-v1:0`
- `BEDROCK_REGION` (or `AWS_REGION`)

Example body:

```json
{
  "query": "iphone 13",
  "instructions": "Summarize price range and best value.",
  "max_tokens": 800,
  "temperature": 0.2
}
```

