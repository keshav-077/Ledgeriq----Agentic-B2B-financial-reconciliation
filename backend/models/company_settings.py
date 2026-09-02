from pydantic import BaseModel, EmailStr
from typing import Optional


class CompanyIdentity(BaseModel):
    company_name: str
    legal_country: str
    identifier_type: str   # EIN | VAT | Tax ID | ABN | BN | GSTIN | Corporate Number | USCC
    identifier_value: str


class CompanyProfile(BaseModel):
    logo_url: Optional[str] = None
    industry: Optional[str] = None   # Manufacturing | Retail | SaaS | Logistics | Other
    company_size: Optional[str] = None  # 1-10 | 11-50 | 51-200 | 200+


class FinancialSettings(BaseModel):
    base_currency: str = "USD"
    fiscal_year_start: str = "01-01"  # MM-DD


class ContactInfo(BaseModel):
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None


class CompanySettingsCreate(BaseModel):
    identity: CompanyIdentity
    profile: Optional[CompanyProfile] = None
    financial: FinancialSettings
    contact: ContactInfo


class CompanySettingsUpdate(BaseModel):
    identity: Optional[CompanyIdentity] = None
    profile: Optional[CompanyProfile] = None
    financial: Optional[FinancialSettings] = None
    contact: Optional[ContactInfo] = None


class CompanySettingsResponse(BaseModel):
    id: str
    identity: CompanyIdentity
    profile: CompanyProfile
    financial: FinancialSettings
    contact: ContactInfo
    onboarding_completed: bool
    created_at: str
    updated_at: str
