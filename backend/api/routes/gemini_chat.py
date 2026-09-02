"""
Gemini AI Chat — Context-Aware Assistant
=========================================
Powers the Ask Gemini side panel.
Gemini receives live MongoDB data as context in every message.
"""
import json
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from motor.motor_asyncio import AsyncIOMotorDatabase
import google.generativeai as genai

from api.dependencies import get_db, get_current_user
from core.config import settings

router = APIRouter()

_ALLOWED_PAGES = frozenset({
    'dashboard', 'counterparties', 'reconciliations', 'discrepancies',
    'integrations', 'reports', 'settings', 'onboarding',
})

SYSTEM_PROMPT = """You are LedgerIQ AI, an expert financial reconciliation assistant embedded in the LedgerIQ platform.

LedgerIQ reconciles account statements between companies and identifies discrepancies:
- Amount Mismatch: same transaction ref, different amounts
- Missing Record: transaction exists on one side only
- Date Mismatch: same amount and ref, different booking dates

You have access to live database snapshots provided in each message.
Be concise, precise, and financially accurate. Reference specific transaction refs, amounts, and dates.
When asked about specific records, use the provided database context to give accurate answers.
Respond in the same language the user writes in."""


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None
    history: list[ChatMessage] = []
    page: Optional[str] = None

    @field_validator('message')
    @classmethod
    def validate_message(cls, v: str) -> str:
        if len(v) > 4000:
            raise ValueError('Message exceeds 4000 character limit')
        return v.strip()

    @field_validator('page')
    @classmethod
    def validate_page(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return v if v in _ALLOWED_PAGES else 'unknown'

    @field_validator('context')
    @classmethod
    def validate_context(cls, v: Optional[dict]) -> Optional[dict]:
        if v is None:
            return v
        if len(json.dumps(v, default=str)) > 2000:
            raise ValueError('Context payload exceeds 2000 character limit')
        return v


class ChatResponse(BaseModel):
    response: str


async def _fetch_live_context(context: Optional[dict], db: AsyncIOMotorDatabase) -> str:
    """Fetch relevant live data from MongoDB to inject into Gemini prompt."""
    parts = []

    # ── Platform overview ────────────────────────────────────────────────────
    total_discs  = await db["discrepancies"].count_documents({})
    pending      = await db["discrepancies"].count_documents({"status": "awaiting_approval"})
    since_30     = await db["discrepancies"].count_documents({
        "detected_at": {"$gte": datetime.utcnow() - timedelta(days=30)}
    })
    parts.append(
        f"Platform overview: {total_discs} total discrepancies, "
        f"{pending} awaiting approval, {since_30} in last 30 days."
    )

    # ── Context-specific enrichment ──────────────────────────────────────────
    if context:
        ctype = context.get("type", "")

        # Company / master balance context
        if ctype in ("master_balance", "company") and context.get("tax_id"):
            company = await db["companies"].find_one({"tax_id": context["tax_id"]})
            if company:
                cid = str(company["_id"])
                discs = []
                async for doc in db["discrepancies"].find({
                    "$or": [{"company_a_id": cid}, {"company_b_id": cid}]
                }).sort("detected_at", -1).limit(5):
                    discs.append(
                        f"  - {doc.get('ledger_ref')}: {doc.get('discrepancy_type')} "
                        f"(${doc.get('difference', 0):,.2f} diff, status: {doc.get('status')})"
                    )
                if discs:
                    parts.append(
                        f"Recent discrepancies for {context.get('company_name', 'this company')}:\n"
                        + "\n".join(discs)
                    )

        # Discrepancy context
        if ctype == "discrepancy" and context.get("ledger_ref"):
            doc = await db["discrepancies"].find_one({"ledger_ref": context["ledger_ref"]})
            if doc:
                parts.append(
                    f"Full discrepancy record for {context['ledger_ref']}:\n"
                    f"  Type: {doc.get('discrepancy_type')}\n"
                    f"  Company A amount: ${doc.get('company_a_amount', 'N/A')}\n"
                    f"  Company B amount: ${doc.get('company_b_amount', 'N/A')}\n"
                    f"  Difference: ${doc.get('difference', 0):,.2f}\n"
                    f"  AI analysis: {doc.get('ai_analysis', 'pending')}\n"
                    f"  Status: {doc.get('status')}"
                )

    return "\n\n".join(parts)


@router.post("/chat", response_model=ChatResponse)
async def gemini_chat(
    request: ChatRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    genai.configure(api_key=settings.GEMINI_API_KEY)

    live_ctx   = await _fetch_live_context(request.context, db)
    system     = SYSTEM_PROMPT

    if live_ctx:
        system += f"\n\n## Live Database Snapshot\n{live_ctx}"
    if request.context:
        system += f"\n\n## Current UI Context\n{json.dumps(request.context, indent=2)}"
    if request.page:
        system += f"\n\nUser is currently on the **{request.page}** page."

    full_message = request.message
    if request.context:
        full_message = (
            f"Context: {json.dumps(request.context)}\n\n"
            f"Platform data: {live_ctx}\n\n"
            f"Question: {request.message}"
        )
    elif live_ctx:
        full_message = f"Platform data: {live_ctx}\n\nQuestion: {request.message}"

    # Primary: ADK runner (uses session service + Gemini 3.5 Flash)
    # Fallback: direct google.generativeai call (works even on cold start)
    response_text: str = ""
    try:
        from agent.adk_engine import ask_lumina
        response_text = await ask_lumina(
            message=full_message,
            user_id="lumina-chat",
        )
    except Exception as adk_err:
        import logging
        logging.getLogger(__name__).warning(
            f"[GeminiChat] ADK ask_lumina failed ({adk_err}), falling back to direct genai call"
        )
        try:
            model = genai.GenerativeModel(
                model_name=settings.GEMINI_MODEL or "gemini-1.5-flash",
                system_instruction=system,
            )
            history_msgs = [
                {
                    "role": m.role if m.role == "user" else "model",
                    "parts": [{"text": m.content}],
                }
                for m in request.history[-10:]
            ]
            chat_session = model.start_chat(history=history_msgs)
            result = chat_session.send_message(full_message)
            response_text = result.text
        except Exception as fallback_err:
            logging.getLogger(__name__).error(f"[GeminiChat] Fallback also failed: {fallback_err}")
            response_text = "I'm having trouble connecting to the AI service right now. Please try again in a moment."

    return ChatResponse(response=response_text)
