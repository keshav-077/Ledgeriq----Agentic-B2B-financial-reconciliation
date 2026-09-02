from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FileRecord(BaseModel):
    id: str
    filename: str
    source: str
    size: int
    counterparty_id: Optional[str] = None
    metadata: dict = {}
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
