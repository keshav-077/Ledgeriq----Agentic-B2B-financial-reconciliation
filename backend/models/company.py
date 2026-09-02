from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Literal, List
from datetime import datetime


class CompanyBase(BaseModel):
    name: str = Field(..., description="Legal company name")
    tax_id: str = Field(..., description="Tax Identification Number (EIN / VAT)")
    reconciliation_email: EmailStr = Field(..., description="Primary reconciliation email")
    contact_name: str = Field(..., description="Name of the reconciliation contact person")
    status: Literal["active", "inactive"] = Field(default="active")
    is_own_company: bool = Field(default=False)
    customer_code: Optional[str] = Field(default=None, description="ERP customer/account code")
    phones: List[str] = Field(default_factory=list, description="Phone numbers (dynamic array)")
    emails: List[str] = Field(default_factory=list, description="Additional email addresses (dynamic array)")

    model_config = {"populate_by_name": True}


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    reconciliation_email: Optional[EmailStr] = None
    contact_name: Optional[str] = None
    status: Optional[Literal["active", "inactive"]] = None
    is_own_company: Optional[bool] = None
    customer_code: Optional[str] = None
    phones: Optional[List[str]] = None
    emails: Optional[List[str]] = None


class CompanyResponse(CompanyBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class BulkImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: List[str]
