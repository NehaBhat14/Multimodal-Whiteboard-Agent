"""FastAPI application entrypoint with CORS for Vite frontend."""

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.env_loader import load_env_file

# Load backend/.env (not repo root): __file__ is backend/app/main.py → parents[1] == backend/
load_env_file(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="Reasoning Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
