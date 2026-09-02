"""
Master Balance Service — extended
==================================
Handles bulk import of our own master ledger (the "Our Books" side) from
Excel / CSV files. Core logic:

  1. Parse file in a thread-pool executor (Windows-safe, no ProactorEventLoop issues).
  2. For every row, attempt to auto-match on tax_id against the companies collection.
     - Match found  → link counterparty_id, status = "matched"
     - No match     → create a draft company entry, status = "pending_match"
  3. Persist rows into the master_balances collection.

Statement upload:
  Parses a detailed transaction sheet (Ref No / Outstanding / CCY) and bulk-upserts
  into the ledgers collection, keyed on (transaction_ref, company_id) — consistent
  with the existing ERP-sync upsert contract.
"""
import asyncio
import csv
import io
import logging
from datetime import datetime
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId

logger = logging.getLogger(__name__)

# ── Column alias tables (case-insensitive header normalisation) ─────────────

MASTER_COL_ALIASES: dict[str, str] = {
    "company name":           "company_name",
    "company":                "company_name",
    "companyname":            "company_name",
    "customer code":          "customer_code",
    "customercode":           "customer_code",
    "customer no":            "customer_code",
    "code":                   "customer_code",
    "tax id - vat number":    "tax_id",
    "tax id":                 "tax_id",
    "tax id/vat number":      "tax_id",
    "vat number":             "tax_id",
    "vat no":                 "tax_id",
    "ein":                    "tax_id",
    "taxid":                  "tax_id",
    "tax_id":                 "tax_id",
    "balance":                "balance",
    "amount":                 "balance",
    "total":                  "balance",
    "currency":               "currency",
    "ccy":                    "currency",
    "cur":                    "currency",
}

STATEMENT_COL_ALIASES: dict[str, str] = {
    "account name":  "account_name",
    "accountname":   "account_name",
    "account":       "account_name",
    "name":          "account_name",
    "description":   "account_name",
    "ref no":        "ref_no",
    "refno":         "ref_no",
    "ref. no":       "ref_no",
    "reference":     "ref_no",
    "ref":           "ref_no",
    "invoice no":    "ref_no",
    "invoice #":     "ref_no",
    "outstanding":   "outstanding",
    "amount":        "outstanding",
    "balance":       "outstanding",
    "open amount":   "outstanding",
    "ccy":           "ccy",
    "currency":      "ccy",
    "cur":           "ccy",
}

# SOA = Statement of Account (multi-company bulk ingestion)
# Extends STATEMENT_COL_ALIASES with customer_code routing columns
SOA_COL_ALIASES: dict[str, str] = {
    **STATEMENT_COL_ALIASES,
    "customer code":  "customer_code",
    "customer no":    "customer_code",
    "cust. code":     "customer_code",
    "cust code":      "customer_code",
    "custcode":       "customer_code",
    "client code":    "customer_code",
    "code":           "customer_code",
    "customer_code":  "customer_code",
}


def _normalize_tax_id(raw) -> str:
    """
    Convert any openpyxl cell value (int, float, str, or None) to a clean Tax ID string.

    openpyxl reads numeric cells as Python int or float, not str.  A Tax ID of
    9876543210 may therefore arrive as the integer 9876543210 or the float
    9876543210.0.  Plain str() would produce "9876543210.0" for the float case,
    causing the MongoDB {"tax_id": "9876543210.0"} lookup to miss the stored
    "9876543210" document and incorrectly trigger auto-create instead of match.

    Rules applied in order:
      None / NaN          → ""   (no lookup attempted)
      int                 → str(int)           9876543210   → "9876543210"
      float               → str(int(float))    9876543210.0 → "9876543210"
      str ending in ".0"  → strip suffix       "9876543210.0" → "9876543210"
      str otherwise       → strip whitespace only (preserves leading zeros and
                            alphanumeric prefixes such as "GB123456789")
    """
    if raw is None:
        return ""
    if isinstance(raw, float):
        if raw != raw:          # NaN guard — float NaN is the only value not equal to itself
            return ""
        try:
            return str(int(raw))
        except (ValueError, OverflowError):
            return str(raw).strip()
    if isinstance(raw, int):
        return str(raw)
    # str branch: CSV files always land here; openpyxl text-formatted cells too.
    s = str(raw).strip()
    if not s or s.lower() in ("none", "nan", "n/a", "-", ""):
        return ""
    # Strip a trailing ".0" that upstream float→str conversions sometimes leave,
    # but only when the prefix is a plain integer so "GB123.0" is kept intact.
    if s.endswith(".0") and s[:-2].lstrip("-").isdigit():
        return s[:-2]
    return s


class MasterBalanceService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db         = db  # Tier-1 Fix: Missing database reference restored
        self.collection = db["master_balances"]
        self.companies  = db["companies"]
        self.ledgers    = db["ledgers"]

    # ── Queries ──────────────────────────────────────────────────────────────

    async def get_all(self) -> list[dict]:
        """
        Tier-1 Dynamic Balance Sync: Tablo her yüklendiğinde, 
        Statement Entries (ledgers) içindeki gerçek toplamı bulur 
        ve 1. görseldeki 'Balance' alanına dinamik olarak basar!
        """
        docs = []
        async for doc in self.collection.find({}, sort=[("created_at", -1)]):
            doc["id"] = str(doc.pop("_id"))
            
            counterparty_id = doc.get("counterparty_id")
            if counterparty_id:
                # Bu şirkete ait yüklenmiş tüm detaylı ekstre kayıtlarını (Statement Entries) çekiyoruz
                cursor = self.ledgers.find({
                    "counterparty_id": counterparty_id,
                    "source": "internal_statement"
                })
                total_outstanding = 0.0
                async for ledger_doc in cursor:
                    total_outstanding += float(ledger_doc.get("amount") or 0.0)
                
                # Eğer detaylı ekstre yüklenmişse, tablodaki statik bakiyeyi ez ve gerçek toplamı yaz!
                if total_outstanding != 0.0:
                    doc["balance"] = total_outstanding

            docs.append(doc)
        return docs

    async def get_statement_entries(self, counterparty_id: str) -> list[dict]:
        """
        Return ledger entries that were ingested via internal uploads OR ERP Agent
        for the given counterparty, ordered newest-first.
        """
        docs = []
        async for doc in self.ledgers.find(
            {
                "counterparty_id": counterparty_id, 
                "source": {"$in": ["internal_statement", "json", "excel", "csv", "sap", "logo", "mikro"]}
            },
            sort=[("created_at", -1)],
        ):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    # ── Master balance import ─────────────────────────────────────────────────

    async def import_from_file(self, file_bytes: bytes, filename: str) -> dict:
        loop = asyncio.get_event_loop()
        lower = filename.lower()

        if lower.endswith(".xlsx") or lower.endswith(".xls"):
            rows = await loop.run_in_executor(None, self._parse_master_excel, file_bytes)
        elif lower.endswith(".csv"):
            rows = await loop.run_in_executor(None, self._parse_master_csv, file_bytes)
        else:
            raise ValueError(f"Unsupported file type: {filename}. Accepted: .xlsx, .xls, .csv")

        matched_count      = 0
        auto_created_count = 0
        saved_records: list[dict] = []

        for row in rows:
            company_name  = str(row.get("company_name", "") or "").strip()
            customer_code = str(row.get("customer_code", "") or "").strip()
            tax_id        = _normalize_tax_id(row.get("tax_id"))

            if not company_name and not tax_id:
                continue  # skip fully empty rows

            try:
                balance = float(str(row.get("balance", 0) or 0).replace(",", "").replace(" ", ""))
            except (ValueError, TypeError):
                balance = 0.0

            currency = str(row.get("currency", "USD") or "USD").strip().upper() or "USD"

            # ── Auto-match or auto-create counterparty ────────────────────
            counterparty_id: Optional[str] = None
            auto_created                    = False

            if tax_id:
                existing = await self.companies.find_one({"tax_id": tax_id})
                if existing:
                    counterparty_id = str(existing["_id"])
                    matched_count  += 1
                else:
                    now_ts = datetime.utcnow()
                    draft  = {
                        "name":                 company_name or tax_id,
                        "tax_id":               tax_id,
                        "reconciliation_email": "",
                        "contact_name":         "",
                        "status":               "active",
                        "is_own_company":       False,
                        "created_at":           now_ts,
                        "updated_at":           now_ts,
                    }
                    result          = await self.companies.insert_one(draft)
                    counterparty_id = str(result.inserted_id)
                    auto_created_count += 1
                    auto_created        = True
                    logger.info(f"[MasterBalance] Auto-created draft counterparty: {company_name} ({tax_id})")

            recon_status = (
                "matched"       if counterparty_id and not auto_created else
                "pending_match"
            )

            now = datetime.utcnow()
            doc = {
                "company_name":              company_name,
                "customer_code":             customer_code,
                "tax_id":                    tax_id,
                "balance":                   balance,
                "currency":                  currency,
                "counterparty_id":           counterparty_id,
                "reconciliation_status":     recon_status,
                "auto_created_counterparty": auto_created,
                "created_at":                now,
                "updated_at":                now,
            }
            insert_result = await self.collection.insert_one(doc)
            doc["id"] = str(insert_result.inserted_id)
            saved_records.append(doc)

        logger.info(
            f"[MasterBalance] Import complete: {len(saved_records)} rows, "
            f"{matched_count} matched, {auto_created_count} auto-created"
        )
        return {
            "imported":    len(saved_records),
            "matched":     matched_count,
            "auto_created": auto_created_count,
            "records":     saved_records,
        }

    # ── Detailed statement upload ─────────────────────────────────────────────

    async def upload_statement(
        self, counterparty_id: str, file_bytes: bytes, filename: str, own_company_id: str
    ) -> dict:
        loop  = asyncio.get_event_loop()
        lower = filename.lower()

        if lower.endswith(".xlsx") or lower.endswith(".xls"):
            rows = await loop.run_in_executor(None, self._parse_statement_excel, file_bytes)
        elif lower.endswith(".csv"):
            rows = await loop.run_in_executor(None, self._parse_statement_csv, file_bytes)
        else:
            raise ValueError(f"Unsupported file type: {filename}. Accepted: .xlsx, .xls, .csv")

        from pymongo import UpdateOne

        now = datetime.utcnow()
        ops: list = []

        for i, row in enumerate(rows):
            account_name = str(row.get("account_name", "")).strip()
            ref_no       = str(row.get("ref_no", "") or "").strip() or f"STMT-{i + 1}"

            try:
                outstanding = float(str(row.get("outstanding", 0) or 0).replace(",", "").replace(" ", ""))
            except (ValueError, TypeError):
                outstanding = 0.0

            ccy = str(row.get("ccy", "USD") or "USD").strip().upper() or "USD"

            ledger_doc = {
                "company_id":       own_company_id,
                "counterparty_id":  counterparty_id,
                "transaction_ref":  ref_no,
                "transaction_type": "invoice",
                "amount":           outstanding,
                "currency":         ccy,
                "transaction_date": now,
                "due_date":         None,
                "description":      account_name,
                "source":           "internal_statement",
                "raw_data":         {k: str(v) for k, v in row.items() if v is not None},
                "updated_at":       now,
            }
            ops.append(
                UpdateOne(
                    {"transaction_ref": ref_no, "company_id": own_company_id},
                    {
                        "$set": ledger_doc,
                        "$setOnInsert": {"status": "pending", "created_at": now},
                    },
                    upsert=True,
                )
            )

        if ops:
            await self.ledgers.bulk_write(ops)

        # Mark all master_balance records for this counterparty as ready_for_external
        await self.collection.update_many(
            {"counterparty_id": counterparty_id},
            {"$set": {"reconciliation_status": "ready_for_external", "updated_at": now}},
        )

        logger.info(
            f"[MasterBalance] Statement uploaded for counterparty {counterparty_id}: "
            f"{len(ops)} rows upserted into ledgers"
        )
        return {"saved": len(ops), "counterparty_id": counterparty_id}

    # ── Delete operations ────────────────────────────────────────────────────

    async def delete_by_id(self, record_id: str, file_storage_svc=None) -> bool:
        """
        Delete a single master_balance record.
        Also removes: associated internal-statement ledger entries for the
        counterparty, and any stored file objects for that counterparty.
        Returns True if the record existed.
        """
        if not ObjectId.is_valid(record_id):
            return False
        doc = await self.collection.find_one({"_id": ObjectId(record_id)})
        if not doc:
            return False

        counterparty_id = doc.get("counterparty_id")

        # Delete associated ledger entries (internal statement rows)
        if counterparty_id:
            await self.ledgers.delete_many({
                "counterparty_id": counterparty_id,
                "source": "internal_statement",
            })

        # Delete file objects for this counterparty (internal statement files)
        if file_storage_svc and counterparty_id:
            await file_storage_svc.delete_by_counterparty(counterparty_id)

        result = await self.collection.delete_one({"_id": ObjectId(record_id)})
        logger.info("[MasterBalance] deleted record %s", record_id)
        return result.deleted_count > 0

    async def bulk_delete(self, record_ids: list[str], file_storage_svc=None) -> int:
        count = 0
        for rid in record_ids:
            if await self.delete_by_id(rid, file_storage_svc):
                count += 1
        return count

    # ── Statement of Account (cross-company bulk ingestion) ───────────────────

    async def import_statement_of_account(
        self,
        file_bytes: bytes,
        filename: str,
        own_company_id: str,
        file_storage_svc=None,
    ) -> dict:
        
        """
        Parse a consolidated Statement of Account file that contains transaction
        rows for multiple clients.  Each row must include a `Customer Code` column
        that maps to an existing master_balance.customer_code.

        Groups rows by customer_code → upserts ledger entries per counterparty →
        flips reconciliation_status to ready_for_external.
        Returns a summary dict suitable for ImportStatementOfAccountResponse.
        """
        # ── TIER-1 HOTFIX: Pydantic Validation Error'ı engellemek için boş e-postaları anında onar ──
        await self.companies.update_many(
            {"reconciliation_email": ""},
            {"$set": {"reconciliation_email": "finance@temporary-draft.com", "contact_name": "Finance Team"}}
        )

        loop = asyncio.get_event_loop()
        lower = filename.lower()

        if lower.endswith(".xlsx") or lower.endswith(".xls"):
            rows = await loop.run_in_executor(None, self._parse_soa_excel, file_bytes)
        elif lower.endswith(".csv"):
            rows = await loop.run_in_executor(None, self._parse_soa_csv, file_bytes)
        else:
            raise ValueError(f"Unsupported file type: {filename}. Accepted: .xlsx, .xls, .csv")

        # Group rows by customer_code
        from collections import defaultdict
        groups: dict[str, list[dict]] = defaultdict(list)
        skipped = 0
        for row in rows:
            code = str(row.get("customer_code") or "").strip()
            if not code:
                skipped += 1
                continue
            groups[code].append(row)

        total_rows     = sum(len(v) for v in groups.values()) + skipped
        companies_hit  = 0
        records_saved  = 0
        details: list[dict] = []

        from pymongo import UpdateOne

        for code, code_rows in groups.items():
            # Look up counterparty via master_balance.customer_code
            mb_doc = await self.collection.find_one({"customer_code": code})
            
            if not mb_doc:
                now_ts = datetime.utcnow()
               
                draft_company = {
                    "name": f"Unknown Client ({code})",
                    "tax_id": f"DRAFT-{code}",
                    "reconciliation_email": f"finance@{code.lower()}.com" if "@" in f"finance@{code.lower()}.com" else f"finance-{code.lower()}@temporary-draft.com",
                    "contact_name": "Finance Team",
                    "status": "active",
                    "is_own_company": False,
                    "created_at": now_ts,
                    "updated_at": now_ts,
                }
                comp_res = await self.companies.insert_one(draft_company)
                counterparty_id = str(comp_res.inserted_id)
                company_name = draft_company["name"]

                # 2. Sonra master_balances koleksiyonuna bu kodu bağla
                mb_doc = {
                    "company_name":   company_name,
                    "customer_code":  code,
                    "tax_id":         f"DRAFT-{code}",
                    "balance":        0.0,
                    "currency":       "USD",
                    "counterparty_id": counterparty_id,
                    "reconciliation_status": "pending_match",
                    "auto_created_counterparty": True,
                    "created_at":     now_ts,
                    "updated_at":     now_ts,
                }
                await self.collection.insert_one(mb_doc)
                logger.info(f"[SOA] Auto-created draft master balance for unrecognized code: {code}")
            else:
                counterparty_id  = mb_doc.get("counterparty_id")
                company_name     = mb_doc.get("company_name", code)

            if not counterparty_id:
                skipped += len(code_rows)
                continue

            companies_hit += 1
            now = datetime.utcnow()
            ops = []

            for i, row in enumerate(code_rows):
                account_name = str(row.get("account_name", "")).strip()
                ref_no       = str(row.get("ref_no", "") or "").strip() or f"SOA-{code}-{i + 1}"
                try:
                    outstanding = float(str(row.get("outstanding", 0) or 0).replace(",", "").replace(" ", ""))
                except (ValueError, TypeError):
                    outstanding = 0.0
                ccy = str(row.get("ccy", "USD") or "USD").strip().upper() or "USD"

                ledger_doc = {
                    "company_id":       own_company_id,
                    "counterparty_id":  counterparty_id,
                    "transaction_ref":  ref_no,
                    "transaction_type": "invoice",
                    "amount":           outstanding,
                    "currency":         ccy,
                    "transaction_date": now,
                    "due_date":         None,
                    "description":      account_name,
                    "source":           "internal_statement",
                    "raw_data":         {k: str(v) for k, v in row.items() if v is not None},
                    "updated_at":       now,
                }
                ops.append(
                    UpdateOne(
                        {"transaction_ref": ref_no, "company_id": own_company_id},
                        {
                            "$set":         ledger_doc,
                            "$setOnInsert": {"status": "pending", "created_at": now},
                        },
                        upsert=True,
                    )
                )

            if ops:
                result = await self.ledgers.bulk_write(ops)
                saved  = result.upserted_count + result.modified_count
                records_saved += saved
            else:
                saved = 0

            # Flip status to ready_for_external
            await self.collection.update_many(
                {"counterparty_id": counterparty_id},
                {"$set": {"reconciliation_status": "ready_for_external", "updated_at": now}},
            )
            details.append({
                "customer_code": code,
                "company_name":  company_name,
                "rows_saved":    saved,
            })

        # Persist global statement archive record
        storage_id = ""
        if file_storage_svc:
            storage_id = await file_storage_svc.save_file(
                file_bytes, filename, "global_statement", metadata={"companies_affected": str(companies_hit)}
            )

        now_ts = datetime.utcnow()
        await self.db["global_statements"].insert_one({
            "filename":           filename,
            "storage_id":         storage_id,
            "uploaded_at":        now_ts,
            "records_processed":  records_saved,
            "companies_affected": companies_hit,
            "size":               len(file_bytes),
            "details":            details,
        })

        logger.info(
            "[SOA] Import complete — %d rows, %d companies matched, %d records saved, %d skipped",
            total_rows, companies_hit, records_saved, skipped,
        )
        return {
            "total_rows":       total_rows,
            "companies_matched": companies_hit,
            "records_saved":    records_saved,
            "skipped_rows":     skipped,
            "details":          details,
        }

    # ── Global Statements archive ─────────────────────────────────────────────

    async def get_global_statements(self) -> list[dict]:
        docs = []
        async for doc in self.db["global_statements"].find({}, sort=[("uploaded_at", -1)]):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    async def delete_global_statement(self, statement_id: str, file_storage_svc=None) -> bool:
        if not ObjectId.is_valid(statement_id):
            return False
        doc = await self.db["global_statements"].find_one({"_id": ObjectId(statement_id)})
        if not doc:
            return False
        if file_storage_svc and doc.get("storage_id"):
            await file_storage_svc.delete_file(doc["storage_id"])
        result = await self.db["global_statements"].delete_one({"_id": ObjectId(statement_id)})
        return result.deleted_count > 0

    # ── File parsers (run via executor — blocking I/O) ────────────────────────

    def _parse_master_excel(self, file_bytes: bytes) -> list[dict]:
        return self._parse_excel(file_bytes, MASTER_COL_ALIASES)

    def _parse_statement_excel(self, file_bytes: bytes) -> list[dict]:
        return self._parse_excel(file_bytes, STATEMENT_COL_ALIASES)

    def _parse_excel(self, file_bytes: bytes, alias_map: dict[str, str]) -> list[dict]:
        import openpyxl
        wb   = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws   = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(c).lower().strip() if c is not None else "" for c in rows[0]]
        mapped  = [alias_map.get(h, h) for h in headers]
        result  = []
        for row in rows[1:]:
            if not any(c is not None for c in row):
                continue
            result.append({mapped[i]: (row[i] if i < len(row) else None) for i in range(len(mapped))})
        return result

    def _parse_master_csv(self, file_bytes: bytes) -> list[dict]:
        return self._parse_csv(file_bytes, MASTER_COL_ALIASES)

    def _parse_statement_csv(self, file_bytes: bytes) -> list[dict]:
        return self._parse_csv(file_bytes, STATEMENT_COL_ALIASES)

    def _parse_csv(self, file_bytes: bytes, alias_map: dict[str, str]) -> list[dict]:
        text   = file_bytes.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        result = []
        for row in reader:
            mapped = {}
            for k, v in row.items():
                key        = alias_map.get((k or "").lower().strip(), (k or "").lower().strip())
                mapped[key] = v
            result.append(mapped)
        return result

    def _parse_soa_excel(self, file_bytes: bytes) -> list[dict]:
        return self._parse_excel(file_bytes, SOA_COL_ALIASES)

    def _parse_soa_csv(self, file_bytes: bytes) -> list[dict]:
        return self._parse_csv(file_bytes, SOA_COL_ALIASES)
