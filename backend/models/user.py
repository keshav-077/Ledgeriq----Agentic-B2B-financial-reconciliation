from pydantic import BaseModel
from typing import Optional, Dict

# ── Permission keys ──────────────────────────────────────────────────────────
# Each key maps to a boolean (True = granted).
PERMISSION_KEYS = [
    "dashboard.view",
    "counterparties.view",
    "counterparties.manage",
    "reconciliations.view",
    "reconciliations.run",
    "discrepancies.view",
    "discrepancies.approve",
    "erp_integration.view",
    "erp_integration.manage",
    "settings.view",
    "settings.edit",
    "users.view",
    "users.manage",
]

# ── Default system roles ─────────────────────────────────────────────────────
SYSTEM_ROLES: Dict[str, Dict[str, bool]] = {
    "System Administrator": {k: True for k in PERMISSION_KEYS},
    "Manager": {
        "dashboard.view": True,
        "counterparties.view": True,
        "counterparties.manage": True,
        "reconciliations.view": True,
        "reconciliations.run": True,
        "discrepancies.view": True,
        "discrepancies.approve": True,
        "erp_integration.view": False,
        "erp_integration.manage": False,
        "settings.view": True,
        "settings.edit": False,
        "users.view": True,
        "users.manage": True,
    },
    "IT Specialist": {
        "dashboard.view": True,
        "counterparties.view": True,
        "counterparties.manage": False,
        "reconciliations.view": True,
        "reconciliations.run": False,
        "discrepancies.view": True,
        "discrepancies.approve": False,
        "erp_integration.view": True,
        "erp_integration.manage": True,
        "settings.view": False,
        "settings.edit": False,
        "users.view": False,
        "users.manage": False,
    },
    "Staff": {
        "dashboard.view": True,
        "counterparties.view": True,
        "counterparties.manage": False,
        "reconciliations.view": True,
        "reconciliations.run": False,
        "discrepancies.view": True,
        "discrepancies.approve": False,
        "erp_integration.view": False,
        "erp_integration.manage": False,
        "settings.view": False,
        "settings.edit": False,
        "users.view": False,
        "users.manage": False,
    },
}


# ── Pydantic models ──────────────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: Dict[str, bool]


class RoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    permissions: Dict[str, bool]
    is_system_role: bool
    created_at: str


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "Staff"
    full_name: Optional[str] = None


class UserUpdate(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    role: str
    full_name: Optional[str] = None
    is_active: bool
    created_at: str
    updated_at: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
