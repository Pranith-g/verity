"""Settings, read from environment variables prefixed with VDC_ (or a .env file)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VDC_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./vdc.db"
    api_key: str | None = None  # when set, every /api call except /api/health needs X-API-Key
    cors_origins: list[str] = ["http://localhost:5173"]
    static_dir: str | None = None  # built frontend to serve from "/", for single-container deploys
    log_level: str = "INFO"

    max_runs_per_study: int = 1500  # the fit is O(n^3); this keeps one request under a few seconds
    max_ask: int = 32
    max_concurrent_races: int = 4
    race_max_budget: int = 600
    races_kept_in_memory: int = 16


@lru_cache
def get_settings() -> Settings:
    return Settings()
