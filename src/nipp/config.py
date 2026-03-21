from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigurationError(RuntimeError):
    """Raised when required runtime configuration is missing or invalid."""


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    mcp_path: str
    host: str
    port: int
    base_url: str | None
    supabase_url: str | None
    supabase_publishable_key: str | None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.getenv("NIPP_DATABASE_URL", os.getenv("DATABASE_URL")),
            mcp_path=_normalize_path(os.getenv("NIPP_MCP_PATH", "/mcp/")),
            host=os.getenv("NIPP_HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", os.getenv("NIPP_PORT", "8000"))),
            base_url=_normalize_optional_url(os.getenv("NIPP_BASE_URL")),
            supabase_url=_normalize_optional_url(os.getenv("SUPABASE_URL")),
            supabase_publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY"),
        )

    def validate(self) -> None:
        if not self.database_url:
            raise ConfigurationError("NIPP_DATABASE_URL is required.")

    def validate_auth(self) -> None:
        missing = [
            name
            for name, value in {
                "NIPP_BASE_URL": self.base_url,
                "SUPABASE_URL": self.supabase_url,
                "SUPABASE_PUBLISHABLE_KEY": self.supabase_publishable_key,
            }.items()
            if not value
        ]
        if missing:
            joined = ", ".join(missing)
            raise ConfigurationError(f"Auth configuration is incomplete. Missing: {joined}.")


def _normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = f"/{path}"
    if not path.endswith("/"):
        path = f"{path}/"
    return path


def _normalize_optional_url(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned.rstrip("/")
