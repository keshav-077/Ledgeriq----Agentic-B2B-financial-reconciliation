"""
Data Normalizer — maps raw ERP column names to the Lumina LedgerCreate schema.
Each ERP system uses different field names; this layer standardizes them before
the records are pushed to the Lumina cloud API.
"""
import uuid
import logging
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)

# Map ERP column names (Turkish & English variants) → Lumina schema field names
COLUMN_MAP: dict = {
    "Fatura No": "transaction_ref",
    "Invoice No": "transaction_ref",
    "Ref No": "transaction_ref",
    "Belge No": "transaction_ref",
    "Tutar": "amount",
    "Amount": "amount",
    "Tarih": "transaction_date",
    "Date": "transaction_date",
    "Vade": "due_date",
    "Due Date": "due_date",
    "Açıklama": "description",
    "Description": "description",
    "Tür": "transaction_type",
    "Type": "transaction_type",
    "Para Birimi": "currency",
    "Currency": "currency",
}

TRANSACTION_TYPE_MAP: dict = {
    "Fatura": "invoice",
    "Invoice": "invoice",
    "Tahsilat": "payment",
    "Payment": "payment",
    "İade": "credit_note",
    "Credit Note": "credit_note",
    "Borç Dekontu": "debit_note",
    "Debit Note": "debit_note",
}

DATE_FORMATS = ["%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"]


class DataNormalizer:
    def __init__(self, company_id: str, source: str, counterparty_mapping: dict = None):
        self.company_id = company_id
        self.source = source
        self.counterparty_mapping = counterparty_mapping or {}

    def normalize(self, raw_records: List[dict]) -> List[dict]:
        normalized = []
        for raw in raw_records:
            try:
                record = self._map_record(raw)
                if record:
                    normalized.append(record)
            except Exception as e:
                logger.warning(f"Skipping unprocessable record: {e} | raw={raw}")
        return normalized

    def _map_record(self, raw: dict) -> Optional[dict]:
        mapped: dict = {}
        for raw_key, raw_val in raw.items():
            lumina_key = COLUMN_MAP.get(str(raw_key).strip(), raw_key.lower().replace(" ", "_"))
            mapped[lumina_key] = raw_val

        # Resolve counterparty_id from tax_id dynamically mapped by the backend
        tax_id = str(raw.get("tax_id") or raw.get("counterparty_tax_id") or "").strip()
        resolved_counterparty_id = self.counterparty_mapping.get(tax_id, "unknown_counterparty")

        return {
            "company_id": self.company_id,
            "counterparty_id": resolved_counterparty_id,
            "transaction_ref": str(mapped.get("transaction_ref") or uuid.uuid4()),
            "transaction_type": TRANSACTION_TYPE_MAP.get(
                str(mapped.get("transaction_type", "")).strip(), "invoice"
            ),
            "amount": float(mapped.get("amount") or 0),
            "currency": str(mapped.get("currency") or "TRY"),
            "transaction_date": self._parse_date(mapped.get("transaction_date")),
            "due_date": self._parse_date(mapped.get("due_date")),
            "description": str(mapped.get("description") or ""),
            "source": self.source,
            "raw_data": raw,
        }

    def _parse_date(self, val) -> Optional[str]:
        if not val:
            return None
        if isinstance(val, datetime):
            return val.isoformat()
        for fmt in DATE_FORMATS:
            try:
                return datetime.strptime(str(val).strip(), fmt).isoformat()
            except ValueError:
                continue
        logger.warning(f"Could not parse date: {val}")
        return None
