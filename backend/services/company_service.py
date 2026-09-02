import os
import re
import io
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from motor.motor_asyncio import AsyncIOMotorDatabase
from models.company import CompanyCreate, CompanyUpdate
from bson import ObjectId
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)


class CompanyService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.collection = db["companies"]

    async def get_all(self) -> List[dict]:
        docs = []
        async for doc in self.collection.find():
            doc["id"] = str(doc.pop("_id"))
            doc.setdefault("status", "active")
            doc.setdefault("is_own_company", False)
            doc.setdefault("phones", [])
            doc.setdefault("emails", [])
            doc.setdefault("customer_code", None)
            docs.append(doc)
        return docs

    async def get_by_id(self, company_id: str) -> Optional[dict]:
        if not ObjectId.is_valid(company_id):
            return None
        doc = await self.collection.find_one({"_id": ObjectId(company_id)})
        if doc:
            doc["id"] = str(doc.pop("_id"))
            doc.setdefault("status", "active")
            doc.setdefault("is_own_company", False)
            doc.setdefault("phones", [])
            doc.setdefault("emails", [])
            doc.setdefault("customer_code", None)
        return doc

    async def get_own_company(self) -> Optional[dict]:
        doc = await self.collection.find_one({"is_own_company": True})
        if not doc:
            doc = await self.collection.find_one({})
        if doc:
            doc["id"] = str(doc.pop("_id"))
            doc.setdefault("status", "active")
            doc.setdefault("is_own_company", False)
            doc.setdefault("phones", [])
            doc.setdefault("emails", [])
            doc.setdefault("customer_code", None)
        return doc

    async def create(self, payload: CompanyCreate) -> dict:
        now = datetime.utcnow()
        doc = payload.model_dump()
        doc["created_at"] = now
        doc["updated_at"] = now
        result = await self.collection.insert_one(doc)
        doc["id"] = str(result.inserted_id)
        return doc

    async def update(self, company_id: str, payload: CompanyUpdate) -> Optional[dict]:
        if not ObjectId.is_valid(company_id):
            return None
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        updates["updated_at"] = datetime.utcnow()
        doc = await self.collection.find_one_and_update(
            {"_id": ObjectId(company_id)},
            {"$set": updates},
            return_document=True,
        )
        if doc:
            doc["id"] = str(doc.pop("_id"))
            doc.setdefault("status", "active")
            doc.setdefault("is_own_company", False)
            doc.setdefault("phones", [])
            doc.setdefault("emails", [])
            doc.setdefault("customer_code", None)
        return doc

    async def cascade_delete(self, company_id: str) -> bool:
        if not ObjectId.is_valid(company_id):
            return False

        doc = await self.collection.find_one({"_id": ObjectId(company_id)})
        if not doc:
            return False

        await self.db["ledgers"].delete_many({
            "$or": [
                {"company_id": company_id},
                {"counterparty_id": company_id},
            ]
        })

        await self.db["reconciliation_sessions"].delete_many({
            "$or": [
                {"counterparty_id": company_id},
                {"initiating_company_id": company_id},
            ]
        })

        await self.db["master_balances"].delete_many({"counterparty_id": company_id})

        file_docs = []
        async for fdoc in self.db["file_objects"].find({"counterparty_id": company_id}):
            file_docs.append(fdoc)
        for fdoc in file_docs:
            try:
                os.remove(fdoc["file_path"])
            except (FileNotFoundError, OSError) as exc:
                logger.warning("[CompanyService] could not remove file: %s", exc)
        await self.db["file_objects"].delete_many({"counterparty_id": company_id})

        result = await self.collection.delete_one({"_id": ObjectId(company_id)})
        logger.info("[CompanyService] cascade-deleted company %s", company_id)
        return result.deleted_count > 0

    async def bulk_cascade_delete(self, company_ids: list[str]) -> int:
        count = 0
        for cid in company_ids:
            if await self.cascade_delete(cid):
                count += 1
        return count

    async def bulk_import_from_excel(self, file_bytes: bytes, filename: str) -> dict:
        """
        Parse Excel/CSV and bulk-upsert counterparties.
        Dynamic column detection for Phone1..PhoneN and Mail/Email1..N.
        File I/O runs in a ThreadPoolExecutor for Windows ProactorEventLoop safety.
        """

        def _parse() -> list[dict]:
            ext = filename.lower().rsplit(".", 1)[-1]
            if ext in ("xlsx", "xls"):
                from openpyxl import load_workbook
                wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
                ws = wb.active
                rows = list(ws.values)
                if not rows:
                    return []
                headers = [str(h).strip() if h is not None else "" for h in rows[0]]
                records = []
                for row in rows[1:]:
                    if all(v is None for v in row):
                        continue
                    records.append(dict(zip(headers, row)))
                return records
            elif ext == "csv":
                import csv
                reader = csv.DictReader(
                    io.StringIO(file_bytes.decode("utf-8", errors="replace"))
                )
                return [dict(r) for r in reader]
            return []

        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=2) as pool:
            raw_records = await loop.run_in_executor(pool, _parse)

        def _find_col(row: dict, *patterns: str) -> Optional[str]:
            for pat in patterns:
                for col in row:
                    if re.match(pat, col.strip(), re.IGNORECASE):
                        return col
            return None

        created = updated = skipped = 0
        errors: list[str] = []
        now = datetime.utcnow()

        for raw in raw_records:
            try:
                name_col    = _find_col(raw, r"company\s*name", r"^name$")
                tax_col     = _find_col(raw, r"tax\s*id.*", r"vat.*", r"ein.*")
                code_col    = _find_col(raw, r"customer\s*code", r"account\s*code", r"^code$")
                contact_col = _find_col(raw, r"contact.*name", r"contact")
                email_col   = _find_col(raw, r"reconciliation.email", r"^email$", r"^mail$")
                status_col  = _find_col(raw, r"^status$")

                name   = str(raw.get(name_col,   "") or "").strip() if name_col   else ""
                tax_id = str(raw.get(tax_col,    "") or "").strip() if tax_col    else ""

                if not name or not tax_id:
                    skipped += 1
                    errors.append("Skipped row: missing required fields (company name or tax ID)")
                    continue

                phone_cols = sorted(
                    [c for c in raw if re.match(r"^phone\d*$", c.strip(), re.IGNORECASE)]
                )
                mail_cols = sorted(
                    [c for c in raw if re.match(r"^(mail|email)\d+$", c.strip(), re.IGNORECASE)]
                )

                phones = [str(raw[c]).strip() for c in phone_cols if raw.get(c) and str(raw[c]).strip()]
                dyn_emails = [str(raw[c]).strip() for c in mail_cols if raw.get(c) and str(raw[c]).strip()]

                recon_email = str(raw.get(email_col, "") or "").strip() if email_col else ""
                if not recon_email and dyn_emails:
                    recon_email = dyn_emails[0]
                if not recon_email:
                    recon_email = f"noreply@{re.sub(r'[^a-z0-9]', '', tax_id.lower())}.invalid"

                existing = await self.collection.find_one({"tax_id": tax_id})
                if existing:
                    update_data: dict = {
                        "name": name,
                        "phones": phones,
                        "emails": dyn_emails,
                        "updated_at": now,
                    }
                    if code_col:
                        update_data["customer_code"] = str(raw.get(code_col, "") or "").strip()
                    if contact_col:
                        c = str(raw.get(contact_col, "") or "").strip()
                        if c:
                            update_data["contact_name"] = c
                    await self.collection.update_one({"tax_id": tax_id}, {"$set": update_data})
                    updated += 1
                else:
                    customer_code = str(raw.get(code_col,    "") or "").strip() if code_col    else ""
                    contact_name  = str(raw.get(contact_col, "") or "").strip() if contact_col else name
                    raw_status    = str(raw.get(status_col,  "") or "").strip().lower() if status_col else "active"
                    status = raw_status if raw_status in ("active", "inactive") else "active"

                    new_doc = {
                        "name":                name,
                        "tax_id":              tax_id,
                        "reconciliation_email": recon_email,
                        "contact_name":        contact_name or name,
                        "status":              status,
                        "is_own_company":      False,
                        "customer_code":       customer_code,
                        "phones":              phones,
                        "emails":              dyn_emails,
                        "created_at":          now,
                        "updated_at":          now,
                    }
                    await self.collection.insert_one(new_doc)
                    created += 1

            except Exception as exc:
                skipped += 1
                errors.append(str(exc))
                logger.warning("[CompanyService.bulk_import] %s", exc)

        return {"created": created, "updated": updated, "skipped": skipped, "errors": errors}

    async def sync_companies(self, records: list[dict]) -> dict:
        """Enterprise Tier-1: Upserts companies from JSON and returns tax_id -> _id mapping."""
        mapping = {}
        now = datetime.utcnow()
        for raw in records:
            tax_id = str(raw.get("tax_id", "")).strip()
            if not tax_id:
                continue
            
            update_data = {
                "name": str(raw.get("name", "")).strip(),
                "reconciliation_email": str(raw.get("reconciliation_email", "")).strip() or f"noreply@{tax_id}.invalid",
                "customer_code": str(raw.get("customer_code", "")).strip(),
                "contact_name": str(raw.get("contact_name", "")).strip(),
                "updated_at": now
            }
            
            doc = await self.collection.find_one_and_update(
                {"tax_id": tax_id},
                {"$set": update_data},
                return_document=True
            )
            
            if not doc:
                new_doc = {**update_data, "tax_id": tax_id, "status": "active", "is_own_company": False, "phones": [], "emails": [], "created_at": now}
                res = await self.collection.insert_one(new_doc)
                mapping[tax_id] = str(res.inserted_id)
            else:
                mapping[tax_id] = str(doc["_id"])
                
        return mapping
