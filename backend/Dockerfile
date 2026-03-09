# BUDLI backend - FastAPI app
FROM python:3.12-slim

WORKDIR /app

# Install system deps (for psycopg2 and optional Playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# RUN playwright install chrome

# Optional: install Playwright browsers if you use in-container browser scraping
# Uncomment the next 2 lines and add playwright to the apt-get above if needed:
RUN playwright install chromium
RUN playwright install chrome || true
RUN playwright install-deps chromium || true

COPY . .

# Load .env at runtime via docker run --env-file .env (do not bake secrets into image)
EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
