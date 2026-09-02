from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import List, Optional

from api.dependencies import get_db, get_current_user, require_permission
from models.discrepancy import DiscrepancyResponse, DiscrepancyUpdate
from services.discrepancy_service import DiscrepancyService

router = APIRouter()


@router.get("/", response_model=List[DiscrepancyResponse])
async def list_discrepancies(
    disc_status: Optional[str] = None,
    company_id: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await DiscrepancyService(db).get_all(status=disc_status, company_id=company_id)


@router.get("/analytics")
async def get_discrepancy_analytics(
    days: int = 90,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    """MongoDB aggregation pipeline — monthly discrepancy trend + type breakdown."""
    days = max(1, min(days, 3650))  # clamp to 1-3650 days to prevent expensive queries
    since = datetime.utcnow() - timedelta(days=days)

    trend_pipeline = [
        {"$match": {"detected_at": {"$gte": since}}},
        {"$group": {
            "_id": {
                "month": {"$dateToString": {"format": "%Y-%m", "date": "$detected_at"}},
                "type":  "$discrepancy_type",
            },
            "count":      {"$sum": 1},
            "total_diff": {"$sum": {"$ifNull": ["$difference", 0]}},
        }},
        {"$sort": {"_id.month": 1}},
    ]

    counterparty_pipeline = [
        {"$match": {"detected_at": {"$gte": since}}},
        {"$group": {
            "_id":        "$company_b_id",
            "count":      {"$sum": 1},
            "total_diff": {"$sum": {"$ifNull": ["$difference", 0]}},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]

    trend_raw, cp_raw = [], []
    async for doc in db["discrepancies"].aggregate(trend_pipeline):
        trend_raw.append({
            "month":      doc["_id"]["month"],
            "type":       doc["_id"]["type"],
            "count":      doc["count"],
            "total_diff": round(doc["total_diff"], 2),
        })
    async for doc in db["discrepancies"].aggregate(counterparty_pipeline):
        cp_raw.append({
            "company_id": doc["_id"],
            "count":      doc["count"],
            "total_diff": round(doc["total_diff"], 2),
        })

    return {
        "trend":              trend_raw,
        "top_counterparties": cp_raw,
        "period_days":        days,
    }


@router.get("/{discrepancy_id}", response_model=DiscrepancyResponse)
async def get_discrepancy(
    discrepancy_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    disc = await DiscrepancyService(db).get_by_id(discrepancy_id)
    if not disc:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    return disc


@router.patch("/{discrepancy_id}", response_model=DiscrepancyResponse)
async def update_discrepancy(
    discrepancy_id: str,
    payload: DiscrepancyUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("discrepancies.view")),
):
    disc = await DiscrepancyService(db).update(discrepancy_id, payload)
    if not disc:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    return disc


@router.post("/{discrepancy_id}/approve", response_model=DiscrepancyResponse)
async def approve_and_send_email(
    discrepancy_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("discrepancies.approve")),
):
    """Human-in-the-Loop approval: confirms the AI-drafted email and triggers SMTP sending."""
    from services.email_service import EmailService
    disc = await DiscrepancyService(db).approve_and_send(discrepancy_id, EmailService())
    if not disc:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    return disc
