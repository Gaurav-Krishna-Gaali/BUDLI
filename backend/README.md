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

Create a `.env` file in the project root:

```bash
copy NUL .env
```

Example `.env` contents:

```dotenv
# AWS credentials (or use your normal AWS config/SSO)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1

# Bedrock model configuration
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
BEDROCK_REGION=us-east-1

# SerpAPI (Google Trends)
SERPAPI_API_KEY=your_serpapi_key
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

