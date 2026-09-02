"""
Lumina ADK Multi-Agent Engine
==============================
Google Agent Development Kit (ADK) — three specialized sub-agents:
  1. ReconciliationAgent  — ledger data, discrepancy detection
  2. AnalysisAgent        — root-cause analysis
  3. CommunicationAgent   — professional email drafting

Orchestrated by lumina_root_agent on Vertex AI Agent Builder.
"""
import json
import os

import motor.motor_asyncio
from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import Content, Part

load_dotenv()

MONGODB_URI     = os.getenv("MONGODB_URI",     "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "lumina_db")

# MCP client — agents route all MongoDB reads through the MCP protocol
from agent.mcp_client import MCPMongoClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(obj):
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    if type(obj).__name__ in ("ObjectId", "datetime", "Decimal128"):
        return str(obj)
    return obj


def _get_db():
    return motor.motor_asyncio.AsyncIOMotorClient(MONGODB_URI)[MONGODB_DB_NAME]


# ── ADK Tools (Python functions exposed to agents) ────────────────────────────

async def get_ledger_pair(company_a_id: str, company_b_id: str) -> str:
    """
    Fetch all ledger records for a counterparty pair via MCP find tool.
    Falls back to direct Motor if MCP is unavailable.
    Returns JSON with company_a_ledgers and company_b_ledgers arrays.
    """
    transport = "mcp"
    try:
        async with MCPMongoClient() as mcp:
            a_ledgers = await mcp._call_tool("find", {
                "collection": "ledgers",
                "filter":     {"company_id": company_a_id, "counterparty_id": company_b_id},
                "limit":      500,
            })
            b_ledgers = await mcp._call_tool("find", {
                "collection": "ledgers",
                "filter":     {"company_id": company_b_id, "counterparty_id": company_a_id},
                "limit":      500,
            })
        if not isinstance(a_ledgers, list): a_ledgers = []
        if not isinstance(b_ledgers, list): b_ledgers = []
    except Exception as e:
        transport = "motor_fallback"
        db = _get_db()
        a_ledgers, b_ledgers = [], []
        async for doc in db["ledgers"].find(
            {"company_id": company_a_id, "counterparty_id": company_b_id}
        ).limit(500):
            a_ledgers.append(_serialize(doc))
        async for doc in db["ledgers"].find(
            {"company_id": company_b_id, "counterparty_id": company_a_id}
        ).limit(500):
            b_ledgers.append(_serialize(doc))

    return json.dumps({
        "company_a_ledgers": a_ledgers,
        "company_b_ledgers": b_ledgers,
        "summary":   f"Company A: {len(a_ledgers)} records, Company B: {len(b_ledgers)} records",
        "transport": transport,
    })


async def get_company_info(company_id: str) -> str:
    """
    Retrieve company profile from MongoDB via MCP find tool.
    Falls back to direct Motor (ObjectId lookup) if MCP returns no results.
    Returns JSON with company name, tax_id, email, and status.
    """
    transport = "mcp"
    try:
        async with MCPMongoClient() as mcp:
            results = await mcp._call_tool("find", {
                "collection": "companies",
                "filter":     {"_id": company_id},
                "limit":      1,
            })
        if isinstance(results, list) and results:
            return json.dumps({**results[0], "transport": transport})
    except Exception:
        pass

    # Motor fallback — ObjectId conversion needed for Atlas _id
    transport = "motor_fallback"
    try:
        from bson import ObjectId
        db  = _get_db()
        doc = await db["companies"].find_one({"_id": ObjectId(company_id)})
        if doc:
            return json.dumps({**_serialize(doc), "transport": transport})
    except Exception:
        pass

    return json.dumps({"error": f"Company {company_id} not found"})


async def get_platform_stats() -> str:
    """
    Get overall Lumina platform statistics via MCP aggregate tool.
    Falls back to direct Motor if MCP is unavailable.
    Returns JSON summary for analytics and reporting.
    """
    transport = "mcp"
    try:
        async with MCPMongoClient() as mcp:
            all_raw = await mcp._call_tool("aggregate", {
                "collection": "discrepancies",
                "pipeline":   [{"$count": "total"}],
            })
            pending_raw = await mcp._call_tool("aggregate", {
                "collection": "discrepancies",
                "pipeline":   [
                    {"$match": {"status": "awaiting_approval"}},
                    {"$count": "total"},
                ],
            })
            breakdown_raw = await mcp._call_tool("aggregate", {
                "collection": "discrepancies",
                "pipeline":   [
                    {"$group": {"_id": "$discrepancy_type", "count": {"$sum": 1}}}
                ],
            })

        total   = all_raw[0]["total"]     if isinstance(all_raw,   list) and all_raw   else 0
        pending = pending_raw[0]["total"] if isinstance(pending_raw, list) and pending_raw else 0
        breakdown = {
            doc["_id"]: doc["count"]
            for doc in (breakdown_raw if isinstance(breakdown_raw, list) else [])
            if doc.get("_id")
        }
        return json.dumps({
            "total_discrepancies": total,
            "awaiting_approval":   pending,
            "by_type":             breakdown,
            "transport":           transport,
        })

    except Exception:
        transport = "motor_fallback"

    from datetime import datetime, timedelta
    db      = _get_db()
    total   = await db["discrepancies"].count_documents({})
    pending = await db["discrepancies"].count_documents({"status": "awaiting_approval"})
    recent  = await db["discrepancies"].count_documents({
        "detected_at": {"$gte": datetime.utcnow() - timedelta(days=30)}
    })
    breakdown = {}
    async for doc in db["discrepancies"].aggregate([
        {"$group": {"_id": "$discrepancy_type", "count": {"$sum": 1}}}
    ]):
        breakdown[doc["_id"]] = doc["count"]

    return json.dumps({
        "total_discrepancies": total,
        "awaiting_approval":   pending,
        "last_30_days":        recent,
        "by_type":             breakdown,
        "transport":           transport,
    })


# ── Agent Instructions ────────────────────────────────────────────────────────

_RECONCILIATION_INSTRUCTION = """
You are Lumina's Reconciliation Agent — specialist in B2B financial ledger analysis.
1. Use get_ledger_pair to fetch transaction records for the given company pair.
2. Compare records by transaction_ref to find mismatches.
3. Classify each:
   - amount_mismatch  : same ref, amounts differ by > $0.01
   - missing_record   : transaction exists on one side only
   - date_mismatch    : same ref + amount, different booking dates
4. Return a structured JSON list of all discrepancies with ref, type, and amounts.
Be precise. Always reference specific transaction_ref values.
"""

_ANALYSIS_INSTRUCTION = """
You are Lumina's Analysis Agent — expert in reconciliation root-cause analysis.
For each discrepancy:
1. Identify the most likely root cause (ERP timing, currency rounding, manual entry, duplicate).
2. Write a concise 2-3 sentence professional analysis.
3. Rate resolution complexity: simple / moderate / complex.
Output must be professional and specific for accounting teams.
"""

_COMMUNICATION_INSTRUCTION = """
You are Lumina's Communication Agent — professional B2B finance communicator.
Draft formal resolution emails that include:
- Specific transaction_ref and discrepancy type
- Both parties' recorded amounts or dates
- A clear, polite request for confirmation or correction
- Formal subject line referencing the transaction ref
Tone: professional, collaborative, non-accusatory.
"""

_ORCHESTRATOR_INSTRUCTION = """
You are Lumina AI — orchestration engine for the Lumina B2B Financial Reconciliation Platform.
You coordinate three specialized agents:
  • ReconciliationAgent : detects ledger discrepancies
  • AnalysisAgent       : explains root causes
  • CommunicationAgent  : drafts resolution emails

For a reconciliation request: delegate to ReconciliationAgent → AnalysisAgent → CommunicationAgent.
For data questions: use get_platform_stats, get_company_info, get_ledger_pair directly.
Always be accurate, professional, and data-driven.
"""


# ── Agent Definitions ─────────────────────────────────────────────────────────

reconciliation_sub_agent = Agent(
    name="reconciliation_agent",
    model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
    description="Fetches B2B ledger data from MongoDB and identifies financial discrepancies",
    instruction=_RECONCILIATION_INSTRUCTION,
    tools=[get_ledger_pair, get_company_info],
)

analysis_sub_agent = Agent(
    name="analysis_agent",
    model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
    description="Provides root-cause analysis for financial discrepancies",
    instruction=_ANALYSIS_INSTRUCTION,
)

communication_sub_agent = Agent(
    name="communication_agent",
    model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
    description="Drafts professional B2B emails for discrepancy resolution",
    instruction=_COMMUNICATION_INSTRUCTION,
)

lumina_root_agent = Agent(
    name="lumina_orchestrator",
    model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
    description="Lumina AI — B2B financial reconciliation multi-agent orchestrator",
    instruction=_ORCHESTRATOR_INSTRUCTION,
    tools=[get_ledger_pair, get_company_info, get_platform_stats],
    sub_agents=[
        reconciliation_sub_agent,
        analysis_sub_agent,
        communication_sub_agent,
    ],
)

async def analyze_discrepancy_adk(
    company_a: dict,
    company_b: dict,
    transaction_ref: str,
    records: dict,
) -> dict:
    """
    ADK multi-agent discrepancy analysis.
    Replaces direct Gemini API — uses ReconciliationAgent + CommunicationAgent.
    """
    rec_a = records.get("company_a_record") or {}
    rec_b = records.get("company_b_record") or {}

    message = f"""Analyze this B2B financial discrepancy and return ONLY valid JSON.

Transaction Reference: {transaction_ref}
Company A ({company_a.get('name', 'Company A')}): amount={rec_a.get('amount')}, date={str(rec_a.get('transaction_date',''))[:10]}, desc={rec_a.get('description','')}
Company B ({company_b.get('name', 'Company B')}): amount={rec_b.get('amount')}, date={str(rec_b.get('transaction_date',''))[:10]}, desc={rec_b.get('description','')}

Return ONLY this JSON (no markdown, no explanation):
{{
  "analysis": "2-3 sentence root cause analysis",
  "email_draft": "Subject: ...\\n\\nFull professional email body"
}}"""

    response = await ask_lumina(
        message=message,
        user_id=f"recon-{transaction_ref[:8]}",
    )

    try:
        import re
        match = re.search(r'\{[\s\S]*\}', response)
        if match:
            return json.loads(match.group())
    except Exception:
        pass

    return {
        "analysis": response,
        "email_draft": f"Subject: Account Reconciliation - {transaction_ref}\n\nDear Team,\n\nWe have identified a discrepancy for transaction {transaction_ref}. Please review.\n\nBest regards",
    }

# ── Runner (used by FastAPI routes) ──────────────────────────────────────────

_session_service = None
_runner          = None

def _get_runner() -> Runner:
    global _session_service, _runner
    if _runner is None:
        _session_service = InMemorySessionService()
        _runner = Runner(
            agent=lumina_root_agent,
            app_name="lumina",
            session_service=_session_service,
        )
    return _runner


async def ask_lumina(
    message: str,
    user_id: str = "default",
    session_id: str | None = None,
) -> str:
    runner = _get_runner()  # initialize _session_service + runner
    if not session_id:
        session    = await _session_service.create_session(
            app_name="lumina", user_id=user_id
        )
        session_id = session.id

    final_text = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=Content(role="user", parts=[Part(text=message)]),
    ):
        if hasattr(event, "is_final_response") and event.is_final_response():
            if event.content and event.content.parts:
                final_text = event.content.parts[0].text or ""

    return final_text or "I couldn't generate a response. Please try again."