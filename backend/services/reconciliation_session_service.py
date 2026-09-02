import secrets
import logging
from datetime import datetime, timedelta
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId

logger = logging.getLogger(__name__)

TOKEN_EXPIRY_HOURS = 168  # 7 days — single-use portal links


class ReconciliationSessionService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["reconciliation_sessions"]
        self.companies = db["companies"]

    async def create(self, initiating_company_id: str, counterparty_id: str) -> dict:
        token = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        doc = {
            "initiating_company_id": initiating_company_id,
            "counterparty_id": counterparty_id,
            "token": token,
            "expires_at": now + timedelta(hours=TOKEN_EXPIRY_HOURS),
            "status": "pending_upload",
            "created_at": now,
            "uploaded_at": None,
            "parsed_ledger_count": 0,
        }
        result = await self.collection.insert_one(doc)
        doc["id"] = str(result.inserted_id)
        logger.info(f"[Session] Created for counterparty {counterparty_id}, expires in 7 days (single-use)")
        return doc

    async def validate_token(self, token: str) -> Optional[dict]:
        doc = await self.collection.find_one({"token": token})
        if not doc:
            return None
        now = datetime.utcnow()
        if doc.get("status") == "expired" or doc["expires_at"] < now:
            await self.collection.update_one({"token": token}, {"$set": {"status": "expired"}})
            return None
        # Single-use: if counterparty already responded, preserve doc for already_used message
        # but mark with a special key so the route can distinguish
        doc["id"] = str(doc.pop("_id"))
        return doc

    async def mark_upload_complete(
        self,
        session_id: str,
        parsed_count: int,
        filename: str | None = None,
        storage_id: str | None = None,
    ) -> None:
        update_data: dict = {
            "status": "processing",
            "uploaded_at": datetime.utcnow(),
            "parsed_ledger_count": parsed_count,
        }
        if filename:
            update_data["filename"] = filename
        if storage_id:
            update_data["storage_id"] = storage_id
        await self.collection.update_one(
            {"_id": ObjectId(session_id)},
            {"$set": update_data},
        )

    async def clear_file_reference(self, session_id: str) -> None:
        """Remove the file storage reference from a session (after file deletion)."""
        if not ObjectId.is_valid(session_id):
            return
        await self.collection.update_one(
            {"_id": ObjectId(session_id)},
            {"$unset": {"storage_id": "", "filename": ""}},
        )

    async def get_by_counterparty(self, counterparty_id: str) -> list[dict]:
        docs = []
        async for doc in self.collection.find(
            {"counterparty_id": counterparty_id},
            sort=[("created_at", -1)],
        ):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    async def get_company_names(
        self, initiating_id: str, counterparty_id: str
    ) -> tuple[str, str]:
        init_doc = (
            await self.companies.find_one({"_id": ObjectId(initiating_id)})
            if ObjectId.is_valid(initiating_id)
            else None
        )
        cp_doc = (
            await self.companies.find_one({"_id": ObjectId(counterparty_id)})
            if ObjectId.is_valid(counterparty_id)
            else None
        )
        return (
            init_doc["name"] if init_doc else "Unknown",
            cp_doc["name"] if cp_doc else "Unknown",
        )
