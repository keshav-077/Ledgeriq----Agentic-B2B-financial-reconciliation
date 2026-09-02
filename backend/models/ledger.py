from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


class LedgerBase(BaseModel):
    company_id: str = Field(..., description="MongoDB ObjectId of the owning company")
    counterparty_id: str = Field(..., description="MongoDB ObjectId of the counterparty company")
    transaction_ref: str = Field(..., description="Unique reference number from the ERP system (UUID or invoice no)")
    transaction_type: Literal["invoice", "payment", "credit_note", "debit_note"]
    amount: float = Field(..., description="Transaction amount in the specified currency")
    currency: str = Field(default="TRY")
    transaction_date: datetime
    due_date: Optional[datetime] = None
    description: str = Field(default="")
    source: str = Field(default="manual", description="ERP source: sap, logo, mikro, excel, csv, manual")
    raw_data: Optional[dict] = Field(default=None, description="Original raw row from ERP export")

    model_config = {"populate_by_name": True}


class LedgerCreate(LedgerBase):
    pass


class LedgerUpdate(BaseModel):
    amount: Optional[float] = None
    description: Optional[str] = None
    status: Optional[Literal["pending", "matched", "unmatched", "disputed"]] = None


class LedgerResponse(LedgerBase):
    id: str
    status: Literal["pending", "matched", "unmatched", "disputed"]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
