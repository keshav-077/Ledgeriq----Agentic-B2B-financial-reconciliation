"""
Gemini Arbitrary Ledger Parser
================================
Uses the google-genai SDK to parse arbitrary Excel / CSV / PDF ledger files
from counterparties and normalise them into Lumina's strict ledger schema.

All synchronous SDK calls run via asyncio.get_event_loop().run_in_executor
to stay Windows thread-pool safe (no ProactorEventLoop subprocess issues).
"""
import asyncio
import io
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_EXTRACTION_PROMPT = """\
You are a financial data extraction AI specialising in Turkish and international ledger statements.

Your task: read the ledger / account-statement data provided and extract EVERY transaction row.

Return a JSON array.  Each element must have EXACTLY these keys — no others:
  "transaction_ref"  : string  — unique reference or document number for this row.
                                 If missing, generate "ROW-<N>" (1-indexed).
  "transaction_type" : string  — MUST be one of: invoice | payment | credit_note | debit_note
                                 Map Turkish terms: fatura→invoice, ödeme/tahsilat→payment,
                                 alacak→credit_note, borç→debit_note.
  "amount"           : number  — positive float, absolute value (strip currency symbols).
  "currency"         : string  — ISO 4217 code, default "TRY" when not stated.
  "transaction_date" : string  — ISO 8601 date "YYYY-MM-DD".
  "description"      : string  — row description or "" if absent.

Rules:
• One JSON object per transaction row — do NOT aggregate rows.
• Strip all thousand-separator dots/commas from amounts; use "." as decimal separator.
• If a date cannot be parsed, use "1970-01-01".
• Return ONLY the raw JSON array.  NO markdown fences, NO explanation text.

Data follows:
"""


class GeminiParser:
    def __init__(self, api_key: str, model: str = "gemini-2.0-flash"):
        self._api_key = api_key
        self.model = model
        self._client: Any = None
        self._legacy_client: Any = None
        self._use_new_sdk = False
        self._init_client()

    def _init_client(self) -> None:
        try:
            from google import genai as google_genai  # google-genai ≥1.0
            self._client = google_genai.Client(api_key=self._api_key)
            self._use_new_sdk = True
            logger.info("[GeminiParser] Using google-genai (new SDK)")
        except (ImportError, Exception):
            try:
                import google.generativeai as genai_legacy  # google-generativeai fallback
                genai_legacy.configure(api_key=self._api_key)
                self._legacy_client = genai_legacy
                logger.info("[GeminiParser] Using google-generativeai (legacy SDK)")
            except ImportError:
                logger.error("[GeminiParser] No Gemini SDK available — install google-genai")

    # ── File-type dispatch ──────────────────────────────────────────────────

    async def parse_ledger_file(self, file_bytes: bytes, filename: str) -> list[dict]:
        lower = filename.lower()
        loop = asyncio.get_event_loop()

        if lower.endswith(".xlsx") or lower.endswith(".xls"):
            text = await loop.run_in_executor(None, self._excel_to_text, file_bytes)
            raw = await self._generate_text(_EXTRACTION_PROMPT + text)

        elif lower.endswith(".csv"):
            text = await loop.run_in_executor(None, self._csv_to_text, file_bytes)
            raw = await self._generate_text(_EXTRACTION_PROMPT + text)

        elif lower.endswith(".pdf"):
            raw = await self._generate_with_pdf(file_bytes)

        else:
            raise ValueError(f"Unsupported file extension: {filename}")

        return self._parse_json_response(raw)

    # ── File converters (run in executor — blocking I/O) ────────────────────

    def _excel_to_text(self, file_bytes: bytes) -> str:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws = wb.active
        rows = []
        for row in ws.iter_rows(values_only=True):
            if any(cell is not None for cell in row):
                rows.append("\t".join("" if c is None else str(c) for c in row))
        return "\n".join(rows)

    def _csv_to_text(self, file_bytes: bytes) -> str:
        import csv
        text = file_bytes.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        return "\n".join("\t".join(row) for row in reader)

    # ── Gemini generation (always in executor for Windows safety) ───────────

    async def _generate_text(self, prompt: str) -> str:
        loop = asyncio.get_event_loop()

        if self._use_new_sdk and self._client:
            def _call() -> str:
                response = self._client.models.generate_content(
                    model=self.model,
                    contents=prompt,
                )
                return response.text.strip()
            return await loop.run_in_executor(None, _call)

        if self._legacy_client:
            model_obj = self._legacy_client.GenerativeModel(self.model)
            response = await model_obj.generate_content_async(prompt)
            return response.text.strip()

        raise RuntimeError("No Gemini client available")

    async def _generate_with_pdf(self, pdf_bytes: bytes) -> str:
        loop = asyncio.get_event_loop()

        if self._use_new_sdk and self._client:
            def _call() -> str:
                from google.genai import types as genai_types
                response = self._client.models.generate_content(
                    model=self.model,
                    contents=[
                        genai_types.Part(
                            inline_data=genai_types.Blob(
                                data=pdf_bytes, mime_type="application/pdf"
                            )
                        ),
                        genai_types.Part(text=_EXTRACTION_PROMPT),
                    ],
                )
                return response.text.strip()
            return await loop.run_in_executor(None, _call)

        # Fallback: extract PDF text and send as plain text
        def _extract_pdf_text() -> str:
            try:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(pdf_bytes))
                return "\n".join(page.extract_text() or "" for page in reader.pages)
            except ImportError:
                return "[PDF content — install pypdf for text extraction]"

        pdf_text = await loop.run_in_executor(None, _extract_pdf_text)
        return await self._generate_text(_EXTRACTION_PROMPT + pdf_text)

    # ── Response parser ─────────────────────────────────────────────────────

    def _parse_json_response(self, text: str) -> list[dict]:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            inner = [l for l in lines[1:] if l != "```"]
            cleaned = "\n".join(inner)
        try:
            data = json.loads(cleaned)
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                for key in ("transactions", "records", "data", "items"):
                    if key in data and isinstance(data[key], list):
                        return data[key]
        except json.JSONDecodeError as e:
            logger.error(f"[GeminiParser] JSON parse error: {e}\nRaw (first 400): {text[:400]}")
        return []
