"""
Cloud Sync — pushes normalized ledger records to the Lumina backend API.
Runs over HTTPS; the backend's /api/v1/ledgers/sync endpoint performs
idempotent upserts so repeated runs never duplicate records.
"""
import logging
from typing import List

import httpx

logger = logging.getLogger(__name__)


class CloudSync:
    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key

    async def push_companies(self, records: List[dict]) -> dict:
        if not records:
            return {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.api_url}/api/v1/companies/sync",
                json=records,
                headers={"X-API-Key": self.api_key, "Content-Type": "application/json"}
            )
        if response.status_code in (200, 201):
            logger.info(f"Master Data Sync: {len(records)} companies processed.")
            return response.json().get("mapping", {})
        logger.error(f"Company sync failed: {response.text}")
        return {}

    async def push_ledgers(self, records: List[dict]) -> bool:
        if not records:
            logger.info("No records to sync — skipping.")
            return True

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.api_url}/api/v1/ledgers/sync",
                json=records,
                headers={
                    "X-API-Key": self.api_key,
                    "Content-Type": "application/json",
                },
            )

        if response.status_code in (200, 201):
            logger.info(f"Synced {len(records)} records successfully.")
            return True

        logger.error(f"Sync failed [{response.status_code}]: {response.text}")
        return False
