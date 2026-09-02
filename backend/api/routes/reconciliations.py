import io
import re
import os
from fastapi import Body
from urllib.parse import quote
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from api.dependencies import get_db, get_current_user, require_permission
from core.config import settings
from services.template_service import generate_template
from models.master_balance import (
    MasterBalanceRecord,
    ImportMasterResponse,
    UploadStatementResponse,
    StatementEntry,
    SendMagicLinkResponse,
    DeleteMasterBalanceResponse,
    GlobalStatementRecord,
    ImportStatementOfAccountResponse,
)
from models.file_storage import FileRecord
from services.master_balance_service import MasterBalanceService
from services.company_service import CompanyService
from services.reconciliation_session_service import ReconciliationSessionService
from services.magic_link_email_service import MagicLinkEmailService
from services.file_storage_service import FileStorageService

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Excel template downloads ──────────────────────────────────────────────────

@router.get("/template/master-balances")
async def download_master_balances_template(
    _: dict = Depends(get_current_user),
):
    data, filename = await generate_template("master_balances")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template/statement-of-account")
async def download_statement_of_account_template(
    _: dict = Depends(get_current_user),
):
    data, filename = await generate_template("statement_of_account")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template/internal-statement")
async def download_internal_statement_template(
    _: dict = Depends(get_current_user),
):
    data, filename = await generate_template("internal_statement")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def _check_extension(filename: str) -> None:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Accepted: {', '.join(_ALLOWED_EXTENSIONS)}",
        )


def _content_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    return {
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls":  "application/vnd.ms-excel",
        ".csv":  "text/csv",
    }.get(ext, "application/octet-stream")


# ── Bulk-delete request model ─────────────────────────────────────────────────

class BulkDeleteRequest(BaseModel):
    ids: List[str]


# ── List / Import ─────────────────────────────────────────────────────────────

@router.get("/", response_model=List[MasterBalanceRecord])
async def list_master_balances(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await MasterBalanceService(db).get_all()


@router.post("/import-master", response_model=ImportMasterResponse)
async def import_master_balances(
    file: UploadFile = File(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    filename = file.filename or "upload.xlsx"
    _check_extension(filename)

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        result = await MasterBalanceService(db).import_from_file(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"[Reconciliations/import-master] Unexpected error: {exc}")
        raise HTTPException(status_code=422, detail=f"File parsing error: {exc}")

    if result["imported"] == 0:
        raise HTTPException(
            status_code=422,
            detail="No valid rows found in file. Ensure the header row uses the required column names.",
        )
    return result


@router.post("/import-statement-of-account", response_model=ImportStatementOfAccountResponse)
async def import_statement_of_account(
    file: UploadFile = File(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    filename = file.filename or "soa_import.xlsx"
    _check_extension(filename)

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    company_svc = CompanyService(db)
    own_company = await company_svc.get_own_company()
    if not own_company:
        raise HTTPException(
            status_code=400,
            detail="No own company configured. Run scripts/seed_mock_data.py first.",
        )

    file_svc = FileStorageService(db, settings.UPLOAD_DIR)

    try:
        result = await MasterBalanceService(db).import_statement_of_account(
            file_bytes, filename, own_company["id"], file_svc
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"[Reconciliations/import-soa] Error: {exc}")
        raise HTTPException(status_code=422, detail=f"File parsing error: {exc}")

    if result["total_rows"] == 0:
        raise HTTPException(
            status_code=422,
            detail="No rows found in file.  Ensure headers include Customer Code.",
        )
    return result


# ── Upload detailed statement ────────────────────────────────────────────────

@router.post(
    "/upload-statement/{counterparty_id}",
    response_model=UploadStatementResponse,
)
async def upload_internal_statement(
    counterparty_id: str,
    file: UploadFile = File(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    company_svc  = CompanyService(db)
    counterparty = await company_svc.get_by_id(counterparty_id)
    if not counterparty:
        raise HTTPException(status_code=404, detail="Counterparty not found.")

    own_company = await company_svc.get_own_company()
    if not own_company:
        raise HTTPException(
            status_code=400,
            detail="No own company configured. Run scripts/seed_mock_data.py first.",
        )

    filename = file.filename or "statement.xlsx"
    _check_extension(filename)

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    await file_svc.save_file(
        file_bytes, filename, source="internal_statement",
        counterparty_id=counterparty_id,
    )

    try:
        result = await MasterBalanceService(db).upload_statement(
            counterparty_id, file_bytes, filename, own_company["id"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"[Reconciliations/upload-statement] Error: {exc}")
        raise HTTPException(status_code=422, detail=f"Statement parsing error: {exc}")

    return UploadStatementResponse(
        saved=result["saved"],
        counterparty_id=counterparty_id,
        message=(
            f"{result['saved']} transaction records saved for "
            f"{counterparty.get('name', counterparty_id)}. "
            "Reconciliation status updated to Ready for External."
        ),
    )


# ── Statement entries / file listing ─────────────────────────────────────────

@router.get("/statements/{counterparty_id}", response_model=List[StatementEntry])
async def get_statement_entries(
    counterparty_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await MasterBalanceService(db).get_statement_entries(counterparty_id)


@router.get("/statement-files/{counterparty_id}", response_model=List[FileRecord])
async def get_statement_files(
    counterparty_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    return await file_svc.list_by_counterparty(counterparty_id)


# ── File download / delete (generic by storage_id) ───────────────────────────

@router.get("/files/{storage_id}/download")
async def download_file(
    storage_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    result   = await file_svc.get_file(storage_id)
    if not result:
        raise HTTPException(status_code=404, detail="File not found.")
    filename, file_bytes = result
    return StreamingResponse(
        iter([file_bytes]),
        media_type=_content_type(filename),
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.delete("/files/{storage_id}", status_code=200)
async def delete_file(
    storage_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    deleted  = await file_svc.delete_file(storage_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="File not found.")
    return {"message": "File deleted."}


# ── Magic link dispatch ───────────────────────────────────────────────────────

class _MagicLinkBody(BaseModel):
    frontend_origin: str = ""

@router.post("/send-magic-link/{counterparty_id}", response_model=SendMagicLinkResponse)
async def send_magic_link_from_reconciliation(
    counterparty_id: str,
    body: _MagicLinkBody = Body(default=_MagicLinkBody()),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.run")),
):
    company_svc = CompanyService(db)

    counterparty = await company_svc.get_by_id(counterparty_id)
    if not counterparty:
        raise HTTPException(status_code=404, detail="Counterparty not found.")

    email = (counterparty.get("reconciliation_email") or "").strip()
    if not email:
        raise HTTPException(
            status_code=422,
            detail=(
                f"'{counterparty['name']}' has no accounting email on file. "
                "Please add one in the Counterparties tab before sending."
            ),
        )
    if not _EMAIL_RE.match(email):
        raise HTTPException(
            status_code=422,
            detail=(
                f"The email address '{email}' appears to be malformed. "
                "Please correct it in the Counterparties tab."
            ),
        )

    own_company = await company_svc.get_own_company()
    if not own_company:
        raise HTTPException(
            status_code=400,
            detail="Your company profile is not configured. Run scripts/seed_mock_data.py first.",
        )

    session_svc = ReconciliationSessionService(db)
    session = await session_svc.create(own_company["id"], counterparty_id)

    _origin = (body.frontend_origin or "").rstrip("/") or settings.FRONTEND_BASE_URL
    email_svc  = MagicLinkEmailService()
    email_sent = await email_svc.send_magic_link(
        counterparty_name=counterparty["name"],
        initiating_company_name=own_company["name"],
        recipient_email=email,
        token=session["token"],
        frontend_base_url=_origin,
    )

    logger.info(
        "[Reconciliations/send-magic-link] Session %s created — counterparty: %s (%s)",
        session["id"], counterparty["name"], email,
    )

    portal_url = f"{_origin}/portal/reconcile?token={session['token']}"
    return SendMagicLinkResponse(
        session_id=session["id"],
        token_preview=session["token"][-8:],
        portal_url=portal_url,
        counterparty_name=counterparty["name"],
        counterparty_email=email,
        email_sent=email_sent,
        message=(
            f"Invitation dispatched to {email}. The portal link is valid for 72 hours."
            if settings.SMTP_USER
            else "Magic link created — SMTP not configured, URL printed to backend logs."
        ),
    )


# ── Delete single / bulk ──────────────────────────────────────────────────────

@router.post("/bulk-delete", response_model=DeleteMasterBalanceResponse)
async def bulk_delete_master_balances(
    payload: BulkDeleteRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    if not payload.ids:
        raise HTTPException(status_code=400, detail="No IDs provided.")
    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    count    = await MasterBalanceService(db).bulk_delete(payload.ids, file_svc)
    return DeleteMasterBalanceResponse(
        deleted=count,
        message=f"{count} record{'s' if count != 1 else ''} and associated data permanently deleted.",
    )


@router.delete("/{record_id}", response_model=DeleteMasterBalanceResponse)
async def delete_master_balance(
    record_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    deleted  = await MasterBalanceService(db).delete_by_id(record_id, file_svc)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found.")
    return DeleteMasterBalanceResponse(deleted=1, message="Record and associated data deleted.")


# ── Global Statements archive ─────────────────────────────────────────────────

@router.get("/global-statements", response_model=List[GlobalStatementRecord])
async def list_global_statements(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await MasterBalanceService(db).get_global_statements()


@router.get("/global-statements/{statement_id}/download")
async def download_global_statement(
    statement_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    from bson import ObjectId
    doc = await db["global_statements"].find_one({"_id": ObjectId(statement_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Statement archive not found.")
    storage_id = doc.get("storage_id")
    if not storage_id:
        raise HTTPException(status_code=404, detail="No file stored for this archive.")

    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    result   = await file_svc.get_file(storage_id)
    if not result:
        raise HTTPException(status_code=404, detail="File not found on server.")

    filename, file_bytes = result
    return StreamingResponse(
        iter([file_bytes]),
        media_type=_content_type(filename),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/global-statements/{statement_id}", status_code=200)
async def delete_global_statement(
    statement_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.view")),
):
    file_svc = FileStorageService(db, settings.UPLOAD_DIR)
    deleted  = await MasterBalanceService(db).delete_global_statement(statement_id, file_svc)
    if not deleted:
        raise HTTPException(status_code=404, detail="Statement archive not found.")
    return {"message": "Global statement archive deleted."}
