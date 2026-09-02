"""
Global Search API
=================
Searches across companies, discrepancies, and master balances.
Discrepancy search uses MongoDB Atlas Vector Search (semantic) when
embeddings are available, falling back to regex text search.
"""
import re
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from api.dependencies import get_db, get_current_user
from core.config import settings

router = APIRouter()


@router.get("/")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    query = q.strip()
    if not query:
        return {"companies": [], "discrepancies": [], "balances": [], "vector_used": False}

    pattern = re.compile(re.escape(query), re.IGNORECASE)

    # ── Companies ─────────────────────────────────────────────────────────────
    companies = []
    async for doc in db["companies"].find({
        "$or": [
            {"name": {"$regex": pattern.pattern, "$options": "i"}},
            {"tax_id": {"$regex": pattern.pattern, "$options": "i"}},
            {"reconciliation_email": {"$regex": pattern.pattern, "$options": "i"}},
        ]
    }).limit(5):
        companies.append({
            "id":       str(doc["_id"]),
            "type":     "company",
            "title":    doc.get("name", ""),
            "subtitle": doc.get("reconciliation_email", ""),
            "meta":     f"Tax ID: {doc.get('tax_id', '—')}",
            "is_own":   doc.get("is_own_company", False),
        })

    # ── Discrepancies — vector search first, text fallback ───────────────────
    vector_used   = False
    discrepancies = await _vector_search(query, db)
    if discrepancies:
        vector_used = True
    else:
        async for doc in db["discrepancies"].find({
            "$or": [
                {"ledger_ref":        {"$regex": pattern.pattern, "$options": "i"}},
                {"discrepancy_type":  {"$regex": pattern.pattern, "$options": "i"}},
                {"ai_analysis":       {"$regex": pattern.pattern, "$options": "i"}},
            ]
        }).limit(5):
            discrepancies.append({
                "id":           str(doc["_id"]),
                "type":         "discrepancy",
                "title":        doc.get("ledger_ref", ""),
                "subtitle":     doc.get("discrepancy_type", "").replace("_", " ").title(),
                "meta":         doc.get("status", ""),
                "company_a_id": doc.get("company_a_id", ""),
                "company_b_id": doc.get("company_b_id", ""),
                "snippet":      (doc.get("ai_analysis") or "")[:120],
            })

    # ── Master Balances ───────────────────────────────────────────────────────
    balances = []
    async for doc in db["master_balances"].find({
        "$or": [
            {"company_name":   {"$regex": pattern.pattern, "$options": "i"}},
            {"tax_id":         {"$regex": pattern.pattern, "$options": "i"}},
            {"customer_code":  {"$regex": pattern.pattern, "$options": "i"}},
        ]
    }).limit(5):
        balances.append({
            "id":       str(doc["_id"]),
            "type":     "balance",
            "title":    doc.get("company_name", ""),
            "subtitle": f"{doc.get('balance', 0):,.2f} {doc.get('currency', 'USD')}",
            "meta":     doc.get("reconciliation_status", "").replace("_", " ").title(),
        })

    return {
        "companies":     companies,
        "discrepancies": discrepancies,
        "balances":      balances,
        "vector_used":   vector_used,
    }


async def _vector_search(query: str, db: AsyncIOMotorDatabase) -> list:
    """Atlas Vector Search — returns [] if index not ready or embeddings missing."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.GEMINI_API_KEY)

        result = genai.embed_content(
            model="models/text-embedding-004",
            content=query,
            task_type="retrieval_query",
        )
        embedding = result["embedding"]

        pipeline = [
            {
                "$vectorSearch": {
                    "index":         "discrepancy_vector_index",
                    "path":          "embedding",
                    "queryVector":   embedding,
                    "numCandidates": 50,
                    "limit":         5,
                }
            },
            {"$addFields": {"score": {"$meta": "vectorSearchScore"}}},
            {"$match":     {"score": {"$gte": 0.65}}},
        ]

        results = []
        async for doc in db["discrepancies"].aggregate(pipeline):
            results.append({
                "id":           str(doc["_id"]),
                "type":         "discrepancy",
                "title":        doc.get("ledger_ref", ""),
                "subtitle":     doc.get("discrepancy_type", "").replace("_", " ").title(),
                "meta":         doc.get("status", ""),
                "company_a_id": doc.get("company_a_id", ""),
                "company_b_id": doc.get("company_b_id", ""),
                "snippet":      (doc.get("ai_analysis") or "")[:120],
                "score":        round(doc.get("score", 0), 3),
            })
        return results
    except Exception:
        return []
