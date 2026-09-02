"""
Cron Runner — async polling loop for the Local ERP Agent.
Reads config from .env and runs a sync_once() cycle at the configured interval.
Uses asyncio.sleep (not threads) — safe on Windows with the default ProactorEventLoop.
"""
import asyncio
import logging
import os
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ERP_SYNC_API_URL = os.getenv("ERP_SYNC_API_URL", "http://localhost:8000")
ERP_SYNC_API_KEY = os.getenv("ERP_SYNC_API_KEY", "")
ERP_POLL_INTERVAL_SECONDS = int(os.getenv("ERP_POLL_INTERVAL_SECONDS", "3600"))
ERP_SOURCE_TYPE = os.getenv("ERP_SOURCE_TYPE", "excel")
ERP_DATA_PATH = os.getenv("ERP_DATA_PATH", "./data/erp_export.xlsx")
COMPANY_ID = os.getenv("COMPANY_ID", "")
COUNTERPARTY_ID = os.getenv("COUNTERPARTY_ID", "")


async def sync_once():
    """Execute Enterprise Two-Step Sync: Master Data -> Transaction Data."""
    from fetcher.erp_reader import ERPReader
    from fetcher.data_normalizer import DataNormalizer
    from sync.cloud_sync import CloudSync

    logger.info(f"Sync cycle starting | source={ERP_SOURCE_TYPE} | path={ERP_DATA_PATH}")

    # 1. Read Raw Dual-Payload (Master + Transactions)
    erp_data = ERPReader(source_type=ERP_SOURCE_TYPE, data_path=ERP_DATA_PATH).read()
    
    companies_raw = erp_data.get("business_partners", []) if isinstance(erp_data, dict) else []
    transactions_raw = erp_data.get("transactions", erp_data) if isinstance(erp_data, dict) else erp_data

    cloud_client = CloudSync(api_url=ERP_SYNC_API_URL, api_key=ERP_SYNC_API_KEY)

    # 2. Step One: Sync Master Data and get ID mapping
    logger.info(f"Step 1: Syncing {len(companies_raw)} Counterparties (Master Data)...")
    mapping = await cloud_client.push_companies(companies_raw)
    logger.info(f"Received ID mapping for {len(mapping)} counterparties.")

    # 3. Step Two: Normalize & Sync Transactions
    normalized_ledgers = DataNormalizer(
        company_id=COMPANY_ID,
        source=ERP_SOURCE_TYPE,
        counterparty_mapping=mapping
    ).normalize(transactions_raw)
    
    logger.info(f"Step 2: Syncing {len(normalized_ledgers)} Ledger Records...")
    await cloud_client.push_ledgers(normalized_ledgers)


async def start_scheduler():
    """Run sync_once on a loop at ERP_POLL_INTERVAL_SECONDS cadence."""
    logger.info(f"Local ERP Agent started — sync every {ERP_POLL_INTERVAL_SECONDS}s.")
    while True:
        try:
            await sync_once()
        except Exception as e:
            logger.error(f"Sync cycle failed: {e}", exc_info=True)
        logger.info(f"Next sync in {ERP_POLL_INTERVAL_SECONDS}s.")
        await asyncio.sleep(ERP_POLL_INTERVAL_SECONDS)
