import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from models.company_settings import CompanySettingsCreate, CompanySettingsUpdate


def _serialize(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    doc.setdefault("profile", {
        "logo_url": None, "industry": None, "company_size": None
    })
    doc.setdefault("onboarding_completed", False)
    # Ensure nested dicts are present
    doc["profile"].setdefault("logo_url", None)
    doc["profile"].setdefault("industry", None)
    doc["profile"].setdefault("company_size", None)
    # Datetime → ISO string
    for field in ("created_at", "updated_at"):
        if isinstance(doc.get(field), datetime):
            doc[field] = doc[field].isoformat()
    return doc


class CompanySettingsService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.col = db["company_settings"]

    async def get(self) -> Optional[dict]:
        """Return the single company_settings document, or None."""
        doc = await self.col.find_one({})
        if doc:
            return _serialize(doc)
        return None

    async def is_onboarding_completed(self) -> bool:
        doc = await self.col.find_one({}, {"onboarding_completed": 1})
        if not doc:
            return False
        return bool(doc.get("onboarding_completed", False))

    async def create(self, payload: CompanySettingsCreate) -> dict:
        now = datetime.now(timezone.utc)
        doc = {
            "identity": payload.identity.model_dump(),
            "profile": (payload.profile or {}).model_dump() if payload.profile else {
                "logo_url": None, "industry": None, "company_size": None
            },
            "financial": payload.financial.model_dump(),
            "contact": payload.contact.model_dump(),
            "onboarding_completed": True,
            "created_at": now,
            "updated_at": now,
        }
        result = await self.col.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _serialize(doc)

    async def update(self, payload: CompanySettingsUpdate) -> Optional[dict]:
        """Partial update of existing settings document."""
        existing = await self.col.find_one({})
        if not existing:
            return None
        update_data: dict = {}
        if payload.identity:
            update_data["identity"] = payload.identity.model_dump()
        if payload.profile:
            update_data["profile"] = payload.profile.model_dump()
        if payload.financial:
            update_data["financial"] = payload.financial.model_dump()
        if payload.contact:
            update_data["contact"] = payload.contact.model_dump()
        update_data["updated_at"] = datetime.now(timezone.utc)

        await self.col.update_one(
            {"_id": existing["_id"]},
            {"$set": update_data},
        )
        updated = await self.col.find_one({"_id": existing["_id"]})
        return _serialize(updated) if updated else None

    async def upload_logo(self, file_bytes: bytes, filename: str) -> str:
        """
        Runs file-write in a ThreadPoolExecutor (Windows ProactorEventLoop safety).
        Returns the public-accessible URL path.
        """
        import os
        from core.config import settings as cfg

        logo_dir = os.path.join(cfg.UPLOAD_DIR, "logos")

        def _write() -> str:
            os.makedirs(logo_dir, exist_ok=True)
            safe_name = f"logo_{ObjectId()}{os.path.splitext(filename)[1]}"
            path = os.path.join(logo_dir, safe_name)
            with open(path, "wb") as f:
                f.write(file_bytes)
            return f"/uploads/logos/{safe_name}"

        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=2) as pool:
            logo_url = await loop.run_in_executor(pool, _write)

        return logo_url
