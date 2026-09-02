import json
import google.generativeai as genai
from core.config import settings
import logging

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """
You are LedgerIQ, an expert autonomous B2B financial reconciliation AI agent.
Your mission is to analyze Account Statement (Cari Hesap Ekstresi) discrepancies 
between two companies' books, determine the root cause of each mismatch, and 
draft professional reconciliation emails in English.

Guidelines:
- Be precise with amounts, dates, currencies, and reference numbers.
- Root cause analysis must be concise (2-3 sentences) and actionable.
- Draft emails in formal English, addressed to the counterparty's accounting team.
- The email should clearly state the mismatch (e.g., missing invoice, wrong amount in the statement) and politely request them to check their ERP/records.
- Always return ONLY valid JSON with keys "analysis" and "email_draft", without markdown blocks like ```json.
"""


class GeminiAgent:
    def __init__(self):
        genai.configure(api_key=settings.GEMINI_API_KEY)
        self.model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            system_instruction=SYSTEM_INSTRUCTION,
        )

    async def analyze_discrepancy(
        self,
        company_a: dict,
        company_b: dict,
        ledger_ref: str,
        records: dict,
    ) -> dict:
        prompt = f"""
Analyze this Account Statement (Cari Hesap Mutabakatı) discrepancy and return a JSON object.

Our Company (Company A): {company_a.get('name')} (Tax ID: {company_a.get('tax_id')})
Counterparty (Company B): {company_b.get('name')} (Tax ID: {company_b.get('tax_id')})
Transaction Reference: {ledger_ref}

Our Record (ERP Data): {json.dumps(records.get('company_a_record'), ensure_ascii=False, default=str)}
Counterparty Record (Portal Upload): {json.dumps(records.get('company_b_record'), ensure_ascii=False, default=str)}

Determine why these statement lines do not match (or if one is missing from a party's books). 
Return ONLY valid JSON with this exact structure:
{{
  "analysis": "<2-3 sentence root cause analysis in English>",
  "email_draft": "<formal reconciliation email body in English from Company A to Company B>"
}}
"""
        try:
            response = await self.model.generate_content_async(prompt)
            text = response.text.strip()
            # Strip markdown fences if present
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text)
        except Exception as e:
            logger.error(f"Gemini response parsing failed for ref {ledger_ref}: {e}")
            return {"analysis": f"Analysis pending (parse error: {e})", "email_draft": ""}

    async def chat(self, message: str) -> str:
        response = await self.model.generate_content_async(message)
        return response.text
