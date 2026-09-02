from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import List
import io

from api.dependencies import get_db, require_permission
from core.config import settings
from models.erp_integration import ErpIntegrationCreate, ErpIntegrationResponse, ErpIntegrationCreatedResponse
from services.erp_integration_service import ErpIntegrationService

router = APIRouter()


@router.get("/", response_model=List[ErpIntegrationResponse])
async def list_integrations(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("erp_integration.view")),
):
    return await ErpIntegrationService(db).list_all()


@router.post("/", response_model=ErpIntegrationCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_integration(
    payload: ErpIntegrationCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("erp_integration.manage")),
):
    return await ErpIntegrationService(db).create(payload.name, payload.description)


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    integration_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("erp_integration.manage")),
):
    deleted = await ErpIntegrationService(db).delete(integration_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Integration not found")


@router.get("/{integration_id}/download-agent")
async def download_agent_package(
    integration_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("erp_integration.manage")),
):
    svc = ErpIntegrationService(db)
    result = await svc.build_agent_package(
        integration_id, settings.FRONTEND_BASE_URL.replace(":3000", ":8000")
    )
    if not result:
        raise HTTPException(status_code=404, detail="Integration not found")

    zip_bytes, filename = result
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
