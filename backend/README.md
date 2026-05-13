# Reasoning Engine Backend

Mock reasoning API for frontend-backend integration. Accepts `VlmInferenceRequest` and returns `VlmInferenceResponse` with echoed spatial coordinates and lifecycle metadata.

## Quickstart

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Configure provider (optional OpenAI inference)

```bash
cp .env.example .env
```

Then edit `backend/.env`:

- `REASONING_PROVIDER=openai` to call OpenAI, or `mock` to keep deterministic responses
- `OPENAI_API_KEY=...` (required when provider is `openai`)
- `OPENAI_MODEL=gpt-4o` (or another supported model)
- `OPENAI_TIMEOUT_SECONDS=60`

### Run development server

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Endpoint: `http://127.0.0.1:8000/api/v1/reason`

### Run tests

```bash
pytest -q
```

## Manual verification

**Request** (POST `/api/v1/reason`):

```json
{
  "imageBase64": "ZmFrZS1pbWFnZS1ieXRlcw==",
  "spatial": {"x": 120.0, "y": 48.0, "width": 320.0, "height": 180.0},
  "queryText": "You are analyzing a cropped region from a digital whiteboard. Describe what is present..."
}
```

**Response** (200):

```json
{
  "dummy_text": "mock reasoning response",
  "spatial": {"x": 120.0, "y": 48.0, "width": 320.0, "height": 180.0},
  "status": "COMPLETED",
  "started_at": "2026-03-20T12:00:00.000000+00:00",
  "finished_at": "2026-03-20T12:00:00.000001+00:00"
}
```

If OpenAI is enabled and unavailable/invalid, the endpoint returns `502` with a provider error in `detail`.
