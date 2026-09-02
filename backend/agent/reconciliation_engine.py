import uuid
import logging
from motor.motor_asyncio import AsyncIOMotorDatabase

from agent.adk_engine import analyze_discrepancy_adk
from agent.mcp_client import MCPMongoClient
from services.ledger_service import LedgerService
from services.discrepancy_service import DiscrepancyService
from services.company_service import CompanyService
from models.discrepancy import DiscrepancyCreate, DiscrepancyUpdate

logger = logging.getLogger(__name__)


class ReconciliationEngine:
    """
    Orchestrates the full reconciliation workflow:
    1. Fetch ledger pairs for two companies from MongoDB
    2. Diff records by transaction_ref to find mismatches
    3. Call GeminiAgent for root-cause analysis and email draft
    4. Persist DiscrepancyInDB with status=awaiting_approval (Human-in-the-Loop)
    """

    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.ledger_svc = LedgerService(db)
        self.disc_svc = DiscrepancyService(db)
        self.company_svc = CompanyService(db)

    async def run(self, company_a_id: str, company_b_id: str, run_id: str = None) -> str:
        if not run_id:
            run_id = str(uuid.uuid4())
        logger.info(f"[Run {run_id}] Starting reconciliation: {company_a_id} ↔ {company_b_id}")

        from datetime import datetime
        await self.db["agent_runs"].insert_one({
            "_id":            run_id,
            "company_a_id":   company_a_id,
            "company_b_id":   company_b_id,
            "status":         "running",
            "discrepancies_found": 0,
            "started_at":     datetime.utcnow(),
            "completed_at":   None,
            "error":          None,
            "steps":          [],
        })

        await self.db["agent_runs"].update_many(
            {
                "company_a_id": company_a_id,
                "company_b_id": company_b_id,
                "status": "running",
                "_id": {"$ne": run_id}
            },
            {"$set": {"status": "cancelled", "completed_at": datetime.utcnow()}}
        )

        await self._log_step(run_id, "loading_companies", "Loading company profiles from MongoDB via MCP...")
        company_a = await self.company_svc.get_by_id(company_a_id)
        company_b = await self.company_svc.get_by_id(company_b_id)
        if not company_a or not company_b:
            logger.error(f"[Run {run_id}] One or both companies not found.")
            await self.db["agent_runs"].update_one(
                {"_id": run_id},
                {"$set": {"status": "failed", "error": "companies_not_found", "completed_at": datetime.utcnow()}},
            )
            return run_id

        await self.db["discrepancies"].delete_many({
            "company_a_id": company_a_id,
            "company_b_id": company_b_id
        })

        import re
        # Bizim kayıtlarımız: internal_statement kaynaklı ve karşı firmaya ait olanlar
        our_filter   = {"counterparty_id": company_b_id, "source": "internal_statement"}
        # Karşı tarafın portal üzerinden yüklediği kayıtlar (bizim firmayı hedefleyen)
        their_filter = {"counterparty_id": company_a_id, "source": re.compile(r"^portal:")}

        try:
            async with MCPMongoClient() as mcp:
                our_side   = await mcp._call_tool("find", {
                    "collection": "ledgers",
                    "filter":     {"counterparty_id": company_b_id, "source": "internal_statement"},
                    "limit":      500,
                })
                their_side = await mcp._call_tool("find", {
                    "collection": "ledgers",
                    "filter":     {"counterparty_id": company_a_id, "source": {"$regex": "^portal:"}},
                    "limit":      500,
                })
            ledgers_a = [d for d in (our_side   if isinstance(our_side,   list) else [])]
            ledgers_b = [d for d in (their_side if isinstance(their_side, list) else [])]
            logger.info(f"[Run {run_id}] MCP fetch: A={len(ledgers_a)}, B={len(ledgers_b)}")
            await self._log_step(run_id, "fetching_ledgers",
                f"Fetching ledger records via MCP: {company_a.get('name','A')} ({len(ledgers_a)} records) ↔ {company_b.get('name','B')} ({len(ledgers_b)} records)")
            if not ledgers_a and not ledgers_b:
                raise RuntimeError("MCP 0 kayıt döndürdü, motor fallback")
            all_refs_preview = set(d.get("transaction_ref") for d in ledgers_a + ledgers_b if d.get("transaction_ref"))
            await self._log_step(run_id, "comparing_records",
                f"Comparing {len(all_refs_preview)} unique transaction references by ledger_ref...")
        except Exception as mcp_err:
            logger.warning(f"[Run {run_id}] MCP unavailable, motor kullanılıyor.")
            ledgers_a, ledgers_b = [], []
            async for doc in self.db["ledgers"].find(our_filter):
                doc["id"] = str(doc.pop("_id", ""))
                ledgers_a.append(doc)
            async for doc in self.db["ledgers"].find(their_filter):
                doc["id"] = str(doc.pop("_id", ""))
                ledgers_b.append(doc)
            logger.info(f"[Run {run_id}] Motor: A={len(ledgers_a)}, B={len(ledgers_b)}")
            await self._log_step(run_id, "fetching_ledgers",
                f"Ledger records fetched (motor fallback): {len(ledgers_a)} + {len(ledgers_b)} records")

            all_refs = set(d.get("transaction_ref") for d in ledgers_a + ledgers_b if d.get("transaction_ref"))
            await self._log_step(run_id, "comparing_records",
                    f"Comparing {len(all_refs)} unique transaction references by ledger_ref...")

        check_run = await self.db["agent_runs"].find_one({"_id": run_id})
        if check_run and check_run.get("status") == "cancelled":
            logger.info(f"[Run {run_id}] Overtaken by a newer manual trigger. Aborting gracefully.")
            return run_id

        map_a: dict = {}
        for l in ledgers_a:
            ref = l.get("transaction_ref")
            if not ref:
                continue
            if ref not in map_a or abs(float(l.get("amount", 0))) > abs(float(map_a[ref].get("amount", 0))):
                map_a[ref] = l

        map_b: dict = {}
        for l in ledgers_b:
            ref = l.get("transaction_ref")
            if not ref:
                continue
            if ref not in map_b or abs(float(l.get("amount", 0))) > abs(float(map_b[ref].get("amount", 0))):
                map_b[ref] = l
        all_refs = set(map_a.keys()) | set(map_b.keys())

        logger.info(f"[HACKATHON-TEST] TUM BENZERSIZ REFERANSLAR (all_refs): {all_refs}")
        logger.info(f"[HACKATHON-TEST] BIZIM KAYITLAR (map_a keys): {list(map_a.keys())}")
        logger.info(f"[HACKATHON-TEST] PORTAL KAYITLARI (map_b keys): {list(map_b.keys())}")

        await self.db["discrepancies"].delete_many({
            "company_a_id": company_a_id,
            "company_b_id": company_b_id
        })

        found = 0
        for ref in all_refs:
            rec_a = map_a.get(ref)
            rec_b = map_b.get(ref)
            dtype = self._classify(rec_a, rec_b)
            if not dtype:

                logger.info(f"[Run {run_id}] >> ROW PERFECTLY MATCHED: {ref} (No discrepancy found)")
                

                for rec in [rec_a, rec_b]:
                    if rec:
                        rec_id = rec.get("_id") or rec.get("id")
                        if rec_id:
                            from bson import ObjectId
                            selector = {"_id": ObjectId(rec_id)} if isinstance(rec_id, str) and ObjectId.is_valid(rec_id) else {"_id": rec_id}
                            await self.db["ledgers"].update_one(selector, {"$set": {"status": "matched"}})
                
                try:
                    val_a_match = float(rec_a["amount"] if rec_a else 0.0)
                    val_b_match = float(rec_b["amount"] if rec_b else 0.0)
                    
                    _ccy_match = (rec_a or rec_b or {}).get("currency") or "USD"
                    payload = DiscrepancyCreate(
                        company_a_id=company_a_id,
                        company_b_id=company_b_id,
                        ledger_ref=ref,
                        discrepancy_type="matched",
                        company_a_amount=val_a_match,
                        company_b_amount=val_b_match,
                        difference=0.0,
                        currency=_ccy_match,
                    )
                    disc = await self.disc_svc.create(payload, agent_run_id=run_id)
                    await self.disc_svc.update(
                        disc["id"],
                        DiscrepancyUpdate(
                            ai_analysis="The system verified that this record matches perfectly on both sides. No reconciliation action or email communication is required.",
                            email_draft="",
                            status="resolved",
                        ),
                    )
                    found += 1
                    logger.info(f"[Run {run_id}] Eşleşen kayıt arayüz için eklendi: {ref}")
                except Exception as db_err:
                    logger.error(f"[Run {run_id}] Eşleşen kayıt arayüze eklenemedi: {ref} - {db_err}")

                continue

            try:
                gemini_result = await analyze_discrepancy_adk(
                    company_a, company_b, ref,
                    {"company_a_record": rec_a, "company_b_record": rec_b},
                )
            except Exception as ai_err:
                logger.warning(f"[Run {run_id}] AI analysis failed for {ref}: {ai_err}")
                gemini_result = {
                    "analysis": f"Discrepancy detected for transaction {ref}. Manual review required.",
                    "email_draft": (
                        f"Subject: Account Reconciliation — {ref}\n\n"
                        f"Dear {company_b.get('name', 'Team')},\n\n"
                        f"We have identified a discrepancy for transaction {ref}. "
                        f"Please review at your earliest convenience.\n\n"
                        f"Best regards,\n{company_a.get('name', 'LedgerIQ')}"
                    ),
                }

            await self._log_step(run_id, "analyzing_discrepancy",
                f"AI analyzing {dtype}: {ref} — ReconciliationAgent → AnalysisAgent → CommunicationAgent")
            try:
                val_a = float(rec_a["amount"] if rec_a else 0.0)
                val_b = float(rec_b["amount"] if rec_b else 0.0)
                
                calculated_diff = abs(abs(val_a) - abs(val_b))

                _ccy = (rec_a or rec_b or {}).get("currency") or "USD"
                payload = DiscrepancyCreate(
                    company_a_id=company_a_id,
                    company_b_id=company_b_id,
                    ledger_ref=ref,
                    discrepancy_type=dtype,
                    company_a_amount=val_a,
                    company_b_amount=val_b,
                    difference=calculated_diff,
                    currency=_ccy,
                )
                disc = await self.disc_svc.create(payload, agent_run_id=run_id)
                await self.disc_svc.update(
                    disc["id"],
                    DiscrepancyUpdate(
                        ai_analysis=gemini_result.get("analysis", ""),
                        email_draft=gemini_result.get("email_draft", ""),
                        status="awaiting_approval",
                    ),
                )
                found += 1
                logger.info(f"[Run {run_id}] Discrepancy saved: {ref} ({dtype})")
            except Exception as db_err:
                logger.error(f"[Run {run_id}] Failed to save discrepancy for {ref}: {db_err}")

        await self._log_step(run_id, "complete",
            f"Reconciliation complete — {found} discrepanc{'y' if found == 1 else 'ies'} found and saved to MongoDB")
        from datetime import datetime
        await self.db["agent_runs"].update_one(
            {"_id": run_id},
            {"$set": {
                "status":              "completed",
                "discrepancies_found": found,
                "completed_at":        datetime.utcnow(),
            }},
        )

        if found == 0:
            await self.db["master_balances"].update_many(
                {"counterparty_id": company_b_id},
                {"$set": {"reconciliation_status": "matched", "updated_at": datetime.utcnow()}}
            )
            logger.info(f"[Run {run_id}] All rows matched! Counterparty status flipped to 'matched'.")

        await self._generate_embeddings(run_id)
        logger.info(f"[Run {run_id}] Reconciliation complete — {found} discrepancies detected.")
        return run_id

    async def _log_step(self, run_id: str, step_type: str, message: str):
        """Append a step to the agent_run document for real-time UI tracking."""
        from datetime import datetime
        step = {
            "type":      step_type,
            "message":   message,
            "timestamp": datetime.utcnow().isoformat(),
        }
        await self.db["agent_runs"].update_one(
            {"_id": run_id},
            {"$push": {"steps": step}}
        )
        logger.info(f"[Run {run_id}] ▶ {message}")

    async def _generate_embeddings(self, run_id: str):
        try:
            import google.generativeai as genai
            from core.config import settings
            genai.configure(api_key=settings.GEMINI_API_KEY)
            async for doc in self.db["discrepancies"].find(
                {"agent_run_id": run_id, "embedding": {"$exists": False}}
            ):
                text = " ".join(filter(None, [
                    doc.get("ledger_ref", ""),
                    doc.get("discrepancy_type", ""),
                    doc.get("ai_analysis", ""),
                ]))
                result = genai.embed_content(
                    model="models/text-embedding-004",
                    content=text,
                    task_type="retrieval_document",
                )
                await self.db["discrepancies"].update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"embedding": result["embedding"]}},
                )
            logger.info(f"[Run {run_id}] Embeddings generated for vector search.")
            await self._log_step(run_id, "generating_embeddings",
                "Vector embeddings saved to Atlas for semantic search.")
        except Exception as e:
            logger.warning(f"[Run {run_id}] Embedding generation skipped: {e}")

    def _classify(self, rec_a: dict, rec_b: dict) -> str:

        if not rec_a or not rec_b:
            return "missing_record"
            
        amt_a = float(rec_a.get("amount") or 0.0)
        amt_b = float(rec_b.get("amount") or 0.0)

        if abs(amt_a + amt_b) < 0.02:
            return None
            
        return "amount_mismatch"
