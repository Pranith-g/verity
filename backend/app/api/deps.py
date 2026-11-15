"""Shared request dependencies."""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from ..config import get_settings


def require_key(x_api_key: str | None = Header(default=None)) -> None:
    """When VDC_API_KEY is set, every protected call must present it."""
    expected = get_settings().api_key
    if not expected:
        return
    if x_api_key is None or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(401, "missing or wrong API key (send it in the X-API-Key header)")
