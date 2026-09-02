"""
Company Settings routes.

GET  /api/v1/settings/                — get current company settings
POST /api/v1/settings/               — create (onboarding completion)
PATCH /api/v1/settings/              — update fields
GET  /api/v1/settings/onboarding-status — check if onboarding is done
POST /api/v1/settings/logo           — upload logo file
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from api.dependencies import get_db, get_current_user, require_permission
from models.company_settings import (
    CompanySettingsCreate, CompanySettingsUpdate, CompanySettingsResponse
)
from services.company_settings_service import CompanySettingsService

router = APIRouter()


@router.get("/onboarding-status")
async def onboarding_status(db: AsyncIOMotorDatabase = Depends(get_db)):
    """Public endpoint — checked right after login to gate the wizard."""
    svc = CompanySettingsService(db)
    completed = await svc.is_onboarding_completed()
    return {"onboarding_completed": completed}


@router.get("/")
async def get_settings(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    svc = CompanySettingsService(db)
    doc = await svc.get()
    if not doc:
        raise HTTPException(status_code=404, detail="Company settings not found")
    return doc


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_settings(
    payload: CompanySettingsCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user: dict = Depends(require_permission("settings.edit")),
):
    svc = CompanySettingsService(db)
    existing = await svc.get()
    if existing:
        raise HTTPException(
            status_code=409, detail="Company settings already exist — use PATCH to update"
        )
    return await svc.create(payload)


@router.patch("/")
async def update_settings(
    payload: CompanySettingsUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user: dict = Depends(require_permission("settings.edit")),
):
    svc = CompanySettingsService(db)
    updated = await svc.update(payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Company settings not found")
    return updated


@router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user: dict = Depends(require_permission("settings.edit")),
):
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=400, detail=f"Unsupported image type: {ext}"
        )
    data = await file.read()
    svc = CompanySettingsService(db)
    logo_url = await svc.upload_logo(data, file.filename or "logo")
    # Save url back to settings
    await svc.update(CompanySettingsUpdate(
        profile=None, identity=None, financial=None, contact=None
    ))
    # Directly patch logo_url
    await db["company_settings"].update_one(
        {}, {"$set": {"profile.logo_url": logo_url}}
    )
    return {"logo_url": logo_url}
