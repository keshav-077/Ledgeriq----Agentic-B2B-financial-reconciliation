from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ErpIntegrationCreate(BaseModel):
    name: str = Field(..., description="Human-readable label for this integration instance")
    description: Optional[str] = Field(default=None)


class ErpIntegrationResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    tracker_id: str
    key_prefix: str
    created_at: datetime
    last_used: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ErpIntegrationCreatedResponse(ErpIntegrationResponse):
    """Returned only on creation — includes the raw API key (shown once)."""
    api_key: str
