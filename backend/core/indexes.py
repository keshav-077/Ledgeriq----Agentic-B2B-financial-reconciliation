import logging

logger = logging.getLogger(__name__)


async def ensure_indexes(db) -> None:
    """Create MongoDB indexes for all hot-path query fields on startup.
    Uses background=True so existing data is not locked during creation.
    All errors are caught — a missing index degrades performance, not correctness.
    """
    try:
        opts = {"background": True}

        await db["companies"].create_index([("tax_id", 1)], **opts)
        await db["companies"].create_index([("is_own_company", 1)], **opts)
        await db["companies"].create_index([("status", 1)], **opts)

        await db["ledgers"].create_index([("company_id", 1), ("counterparty_id", 1)], **opts)
        await db["ledgers"].create_index([("transaction_ref", 1), ("company_id", 1)], **opts)
        await db["ledgers"].create_index([("counterparty_id", 1)], **opts)
        await db["ledgers"].create_index([("source", 1)], **opts)
        await db["ledgers"].create_index([("status", 1)], **opts)

        await db["discrepancies"].create_index([("company_a_id", 1), ("company_b_id", 1)], **opts)
        await db["discrepancies"].create_index([("status", 1)], **opts)
        await db["discrepancies"].create_index([("agent_run_id", 1)], **opts)
        await db["discrepancies"].create_index([("detected_at", -1)], **opts)

        await db["master_balances"].create_index([("counterparty_id", 1)], **opts)
        await db["master_balances"].create_index([("tax_id", 1)], **opts)
        await db["master_balances"].create_index([("customer_code", 1)], **opts)
        await db["master_balances"].create_index([("reconciliation_status", 1)], **opts)

        await db["agent_runs"].create_index([("company_a_id", 1), ("company_b_id", 1)], **opts)
        await db["agent_runs"].create_index([("status", 1)], **opts)
        await db["agent_runs"].create_index([("started_at", -1)], **opts)

        await db["reconciliation_sessions"].create_index([("token", 1)], **opts)
        await db["reconciliation_sessions"].create_index([("counterparty_id", 1)], **opts)
        await db["reconciliation_sessions"].create_index([("status", 1)], **opts)

        await db["erp_integrations"].create_index([("key_prefix", 1)], **opts)

        await db["users"].create_index([("username", 1)], **opts)
        await db["users"].create_index([("email", 1)], **opts)

        logger.info("[LedgerIQ] MongoDB indexes ensured.")
    except Exception as exc:
        logger.warning("[LedgerIQ] Index creation skipped (non-fatal): %s", exc)
