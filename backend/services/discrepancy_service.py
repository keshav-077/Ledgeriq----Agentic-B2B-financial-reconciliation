from motor.motor_asyncio import AsyncIOMotorDatabase
from models.discrepancy import DiscrepancyCreate, DiscrepancyUpdate
from bson import ObjectId
from datetime import datetime
from typing import List, Optional


class DiscrepancyService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["discrepancies"]

    async def get_all(self, status: Optional[str] = None, company_id: Optional[str] = None) -> List[dict]:
        query = {}
        if status:
            query["status"] = status
        if company_id:
            query["$or"] = [{"company_a_id": company_id}, {"company_b_id": company_id}]
        docs = []
        async for doc in self.collection.find(query).sort("detected_at", -1):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    async def get_by_id(self, disc_id: str) -> Optional[dict]:
        if not ObjectId.is_valid(disc_id):
            return None
        doc = await self.collection.find_one({"_id": ObjectId(disc_id)})
        if doc:
            doc["id"] = str(doc.pop("_id"))
        return doc

    async def create(self, payload: DiscrepancyCreate, agent_run_id: str = "") -> dict:
        doc = payload.model_dump()
        doc["status"] = "detected"
        doc["ai_analysis"] = ""
        doc["email_draft"] = None
        doc["agent_run_id"] = agent_run_id
        doc["detected_at"] = datetime.utcnow()
        doc["resolved_at"] = None
        result = await self.collection.insert_one(doc)
        doc["id"] = str(result.inserted_id)
        return doc

    async def update(self, disc_id: str, payload: DiscrepancyUpdate) -> Optional[dict]:
        if not ObjectId.is_valid(disc_id):
            return None
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        doc = await self.collection.find_one_and_update(
            {"_id": ObjectId(disc_id)},
            {"$set": updates},
            return_document=True,
        )
        if doc:
            doc["id"] = str(doc.pop("_id"))
        return doc

    async def approve_and_send(self, disc_id: str, email_service) -> Optional[dict]:
        """Human-in-the-Loop: validate, send email, and mark resolved."""
        disc = await self.get_by_id(disc_id)
        if not disc:
            return None
        if disc.get("email_draft"):
            await email_service.send_reconciliation_email(disc)
        return await self.update(disc_id, DiscrepancyUpdate(status="email_sent", resolved_at=datetime.utcnow()))
