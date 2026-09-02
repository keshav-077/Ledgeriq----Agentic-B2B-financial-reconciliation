from pydantic import BaseModel, Field
from typing import Optional, Literal, List, Any
from datetime import datetime


class MasterBalanceRecord(BaseModel):
    id: str
    company_name: str
    customer_code: str = ""
    tax_id: str = ""
    balance: float
    currency: str = "USD"
    counterparty_id: Optional[str] = None
    reconciliation_status: Literal["pending_match", "matched", "ready_for_external"] = "pending_match"
    auto_created_counterparty: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class ImportMasterResponse(BaseModel):
    imported: int
    matched: int
    auto_created: int
    records: List[MasterBalanceRecord]


class UploadStatementResponse(BaseModel):
    saved: int
    counterparty_id: str
    message: str


class StatementEntry(BaseModel):
    """A single ledger row from an uploaded internal statement."""
    id: str
    transaction_ref: str
    description: str = ""
    amount: float = 0.0
    currency: str = "USD"
    status: str = "pending"
    created_at: Optional[datetime] = None
    transaction_date: Optional[datetime] = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class SendMagicLinkResponse(BaseModel):
    """Result returned after dispatching a reconciliation invitation."""
    session_id: str
    token_preview: str
    portal_url: str = ""
    counterparty_name: str
    counterparty_email: str
    email_sent: bool
    message: str


class DeleteMasterBalanceResponse(BaseModel):
    deleted: int
    message: str


class GlobalStatementRecord(BaseModel):
    id: str
    filename: str
    uploaded_at: datetime
    records_processed: int
    companies_affected: int
    size: int
    storage_id: str

    model_config = {"from_attributes": True, "populate_by_name": True}


class ImportStatementOfAccountResponse(BaseModel):
    total_rows: int
    companies_matched: int
    records_saved: int
    skipped_rows: int
    details: List[Any] = []
