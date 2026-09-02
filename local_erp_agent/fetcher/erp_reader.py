"""
ERP Reader — reads raw transaction records from local ERP systems or file exports.
Supports: Excel (.xlsx), CSV, SAP (stub), Logo (stub), Mikro (stub).
"""
import logging
from pathlib import Path
from typing import List

import pandas as pd

logger = logging.getLogger(__name__)


class ERPReader:
    def __init__(self, source_type: str, data_path: str):
        self.source_type = source_type.lower()
        self.data_path = Path(data_path)

    def read(self):
        """Return raw ERP payload (dict for JSON, list for legacy files)."""
        readers = {
            "excel": self._read_excel,
            "xlsx": self._read_excel,
            "csv": self._read_csv,
            "json": self._read_json,
            "sap": self._read_sap,
            "logo": self._read_logo,
            "mikro": self._read_mikro,
        }
        reader = readers.get(self.source_type)
        if not reader:
            raise ValueError(f"Unsupported ERP source type: {self.source_type}")
        return reader()

    def _read_excel(self) -> List[dict]:
        df = pd.read_excel(self.data_path, dtype=str)
        return df.where(pd.notna(df), None).to_dict(orient="records")

    def _read_csv(self) -> List[dict]:
        df = pd.read_csv(self.data_path, dtype=str)
        return df.where(pd.notna(df), None).to_dict(orient="records")

    def _read_json(self) -> dict:
        import json
        with open(self.data_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _read_sap(self) -> List[dict]:
        # TODO Phase 1.5: SAP RFC connection or BAPI file export reader
        logger.warning("SAP reader not yet implemented — returning empty list")
        return []

    def _read_logo(self) -> List[dict]:
        # TODO Phase 1.5: Logo Tiger MSSQL database connection
        logger.warning("Logo reader not yet implemented — returning empty list")
        return []

    def _read_mikro(self) -> List[dict]:
        # TODO Phase 1.5: Mikro database connection
        logger.warning("Mikro reader not yet implemented — returning empty list")
        return []
