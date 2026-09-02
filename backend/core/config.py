from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import AliasChoices, Field, computed_field, model_validator
from typing import List

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _BACKEND_DIR.parent
_ENV_FILES = [
    str(path)
    for path in (_PROJECT_ROOT / ".env", _BACKEND_DIR / ".env")
    if path.is_file()
]


class Settings(BaseSettings):
    # MongoDB — keep default db name to avoid looking like an empty migration
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "lumina_db"

    # Google Cloud / Gemini
    GOOGLE_CLOUD_PROJECT: str = ""
    GOOGLE_CLOUD_LOCATION: str = "us-central1"
    GEMINI_MODEL: str = "gemini-3-flash-preview"
    GEMINI_API_KEY: str = ""

    # Email (SMTP)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@ledgeriq.local"

    # Backend
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    SECRET_KEY: str = "change-me-in-production"
    DEBUG: bool = False
    allowed_origins_raw: str = Field(
        default="http://localhost:3000",
        validation_alias="ALLOWED_ORIGINS",
    )
    FRONTEND_BASE_URL: str = "http://localhost:3000"

    # Admin seed (first login)
    ADMIN_USERNAME: str = Field(
        default="admin",
        validation_alias=AliasChoices("ADMIN_USERNAME", "LUMINA_USERNAME"),
    )
    ADMIN_PASSWORD: str = Field(
        default="",
        validation_alias=AliasChoices("ADMIN_PASSWORD", "LUMINA_PASSWORD"),
    )
    ADMIN_EMAIL: str = Field(
        default="admin@ledgeriq.local",
        validation_alias=AliasChoices("ADMIN_EMAIL", "LUMINA_ADMIN_EMAIL"),
    )

    @computed_field
    @property
    def ALLOWED_ORIGINS(self) -> List[str]:
        if not self.allowed_origins_raw:
            return ["http://localhost:3000"]
        return [s.strip() for s in self.allowed_origins_raw.split(",") if s.strip()]

    # File storage
    UPLOAD_DIR: str = "./uploaded_files"

    model_config = {
        "env_file": _ENV_FILES or str(_PROJECT_ROOT / ".env"),
        "case_sensitive": True,
        "extra": "ignore",
    }

    @model_validator(mode="after")
    def reject_insecure_secret_in_production(self):
        insecure = self.SECRET_KEY in ("change-me-in-production", "", "changeme")
        if not self.DEBUG and insecure:
            raise ValueError(
                "SECRET_KEY is insecure. Set a strong random SECRET_KEY in your environment "
                "before running with DEBUG=false."
            )
        return self


settings = Settings()
