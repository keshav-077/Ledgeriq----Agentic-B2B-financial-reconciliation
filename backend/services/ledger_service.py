from motor.motor_asyncio import AsyncIOMotorDatabase
from models.ledger import LedgerCreate, LedgerUpdate
from bson import ObjectId
from datetime import datetime
from typing import List, Optional


class LedgerService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.collection = db["ledgers"]

    async def get_all(self, company_id: Optional[str] = None, status: Optional[str] = None) -> List[dict]:
        query = {}
        if company_id:
            query["company_id"] = company_id
        if status:
            query["status"] = status
        docs = []
        async for doc in self.collection.find(query).sort("transaction_date", -1):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    async def get_by_id(self, ledger_id: str) -> Optional[dict]:
        if not ObjectId.is_valid(ledger_id):
            return None
        doc = await self.collection.find_one({"_id": ObjectId(ledger_id)})
        if doc:
            doc["id"] = str(doc.pop("_id"))
        return doc

    async def create(self, payload: LedgerCreate) -> dict:
        now = datetime.utcnow()
        doc = payload.model_dump()
        doc["status"] = "pending"
        doc["created_at"] = now
        doc["updated_at"] = now
        result = await self.collection.insert_one(doc)
        doc["id"] = str(result.inserted_id)
        return doc

    async def bulk_upsert(self, payloads: List[LedgerCreate]) -> List[dict]:
        """
        Upsert records keyed on (transaction_ref, company_id) to prevent duplicate
        entries from repeated ERP sync cycles run by the Local ERP Agent.
        """
        from pymongo import UpdateOne
        from bson import ObjectId

        now = datetime.utcnow()
        ops = []
        
        for payload in payloads:
            doc = payload.model_dump()
            doc["updated_at"] = now
            
            ops.append(
                UpdateOne(
                    {"transaction_ref": doc["transaction_ref"], "company_id": doc["company_id"]},
                    {
                        "$set": doc,
                        "$setOnInsert": {"status": "pending", "created_at": now},
                    },
                    upsert=True,
                )
            )
            
        if ops:
            await self.collection.bulk_write(ops)

        # ERP Entegrasyonu: Gelen ERP verilerini konsolide edip "Cari Hesap Listesine (Recon List)" yansıt
        grouped = {}
        for p in payloads:
            c_id = p.counterparty_id
            if not c_id: continue
            if c_id not in grouped:
                grouped[c_id] = {"currency": p.currency or "USD", "company_id": p.company_id}

        mb_ops = []
        for c_id, data in grouped.items():
            if not ObjectId.is_valid(c_id): continue
            
            # TIER-1 BAKIYE HESAPLAMA: Veritabanındaki UPSERT edilmiş (tekrarsız) kayıtları topla!
            pipeline = [
                {"$match": {"counterparty_id": c_id, "company_id": data["company_id"]}},
                {"$group": {
                    "_id": None,
                    "net_balance": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$transaction_type", "payment"]},
                                {"$multiply": ["$amount", -1]},
                                "$amount"
                            ]
                        }
                    }
                }}
            ]
            agg_result = await self.collection.aggregate(pipeline).to_list(length=1)
            net_balance = agg_result[0]["net_balance"] if agg_result else 0.0

            cp_doc = await self.db["companies"].find_one({"_id": ObjectId(c_id)})
            if cp_doc:
                mb_ops.append(
                    UpdateOne(
                        {"counterparty_id": c_id},
                        {
                            "$set": {
                                "company_name": cp_doc.get("name", "Unknown"),
                                "tax_id": cp_doc.get("tax_id", ""),
                                "customer_code": cp_doc.get("customer_code", ""),
                                "balance": net_balance,
                                "currency": data["currency"],
                                "reconciliation_status": "ready_for_external",
                                "updated_at": now
                            },
                            "$setOnInsert": {
                                "created_at": now,
                                "company_id": data["company_id"]
                            }
                        },
                        upsert=True
                    )
                )
        if mb_ops:
            await self.db["master_balances"].bulk_write(mb_ops)

        company_ids = list({p.company_id for p in payloads})
        return await self.get_all(company_id=company_ids[0] if len(company_ids) == 1 else None)

    async def update(self, ledger_id: str, payload: LedgerUpdate) -> Optional[dict]:
        if not ObjectId.is_valid(ledger_id):
            return None
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        updates["updated_at"] = datetime.utcnow()
        doc = await self.collection.find_one_and_update(
            {"_id": ObjectId(ledger_id)},
            {"$set": updates},
            return_document=True,
        )
        if doc:
            doc["id"] = str(doc.pop("_id"))
        return doc
