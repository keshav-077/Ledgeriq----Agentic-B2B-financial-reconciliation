from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


class ReconciliationSessionCreate(BaseModel):
    initiating_company_id: str = Field(..., description="MongoDB ObjectId of the initiating (own) company")
    counterparty_id: str = Field(..., description="MongoDB ObjectId of the counterparty company")


class ReconciliationSessionResponse(BaseModel):
    id: str
    initiating_company_id: str
    counterparty_id: str
    token: str
    expires_at: datetime
    status: Literal["pending_upload", "processing", "completed", "expired"]
    created_at: datetime
    uploaded_at: Optional[datetime] = None
    parsed_ledger_count: int = 0
    filename: Optional[str] = None
    storage_id: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class TokenValidationResponse(BaseModel):
    valid: bool
    already_used: bool = False  # True when token was valid but already responded
    session_id: Optional[str] = None
    initiating_company_name: Optional[str] = None
    counterparty_name: Optional[str] = None
    expires_at: Optional[datetime] = None
    message: Optional[str] = None


class PortalUploadResponse(BaseModel):
    session_id: str
    parsed_count: int
    message: str
