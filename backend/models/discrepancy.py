from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


class DiscrepancyBase(BaseModel):
    company_a_id: str = Field(..., description="MongoDB ObjectId of Company A (the initiating company)")
    company_b_id: str = Field(..., description="MongoDB ObjectId of Company B (the counterparty)")
    ledger_ref: str = Field(..., description="Transaction reference number with the discrepancy")
    discrepancy_type: Literal["amount_mismatch", "missing_record", "date_mismatch", "duplicate", "matched"]
    company_a_amount: Optional[float] = Field(default=None, description="Amount as recorded by Company A")
    company_b_amount: Optional[float] = Field(default=None, description="Amount as recorded by Company B")
    difference: Optional[float] = Field(default=None, description="Absolute difference between the two amounts")
    currency: Optional[str] = Field(default="USD", description="Transaction currency code (ISO 4217)")

    model_config = {"populate_by_name": True}


class DiscrepancyCreate(DiscrepancyBase):
    pass


class DiscrepancyUpdate(BaseModel):
    status: Optional[Literal["detected", "awaiting_approval", "email_sent", "resolved", "disputed"]] = None
    ai_analysis: Optional[str] = None
    email_draft: Optional[str] = None
    resolved_at: Optional[datetime] = None


class DiscrepancyResponse(DiscrepancyBase):
    id: str
    ai_analysis: str
    email_draft: Optional[str]
    status: Literal["detected", "awaiting_approval", "email_sent", "resolved", "disputed"]
    agent_run_id: str
    detected_at: datetime
    resolved_at: Optional[datetime]

    model_config = {"from_attributes": True, "populate_by_name": True}
