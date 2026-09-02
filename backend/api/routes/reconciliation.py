from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from api.dependencies import get_db, get_current_user, require_permission

router = APIRouter()


@router.post("/run")
async def trigger_reconciliation(
    company_b_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.run")),
    company_a_id: str | None = None,
):
    # Determine own company from company_settings if not provided by frontend
    if not company_a_id:
        from services.company_service import CompanyService as _CS
        own = await _CS(db).get_own_company()
        if not own:
            raise HTTPException(
                status_code=400,
                detail="Own company not configured. Complete onboarding in Settings first.",
            )
        company_a_id = own["id"]
    """
    Trigger the reconciliation agent asynchronously — returns run_id immediately
    so the frontend AgentIsland can display live progress while the agent runs.
    """
    import uuid
    from agent.reconciliation_engine import ReconciliationEngine

    run_id = str(uuid.uuid4())

    async def _run_in_background(a_id: str, b_id: str, r_id: str):
        from agent.reconciliation_engine import ReconciliationEngine as RE
        eng = RE(db)
        await eng.run(a_id, b_id, r_id)

    background_tasks.add_task(_run_in_background, company_a_id, company_b_id, run_id)

    return {
        "status":  "started",
        "run_id":  run_id,
        "message": f"Reconciliation agent started for {company_a_id} ↔ {company_b_id}",
    }


@router.get("/runs")
async def list_agent_runs(
    limit: int = Query(50, le=200),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    """Return all agent runs ordered by most recent, including steps."""
    runs = []
    async for doc in db["agent_runs"].find().sort("started_at", -1).limit(limit):
        doc["id"] = str(doc.pop("_id"))
        runs.append(doc)
    return runs

@router.post("/cancel/{run_id}")
async def cancel_agent_run(
    run_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("reconciliations.run")),
):
    """
    Cancel a running agent run — sets status to 'cancelled'.
    The ReconciliationEngine polls this on each step and aborts gracefully.
    """
    from datetime import datetime
    doc = await db["agent_runs"].find_one({"_id": run_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found.")
    if doc.get("status") != "running":
        raise HTTPException(
            status_code=400,
            detail=f"Run cannot be cancelled (current status: {doc.get('status')}).",
        )
    await db["agent_runs"].update_one(
        {"_id": run_id},
        {"$set": {
            "status":       "cancelled",
            "completed_at": datetime.utcnow(),
            "error":        "Cancelled by user",
        }},
    )
    return {"status": "cancelled", "run_id": run_id, "message": "Run cancelled successfully."}

@router.get("/status/{run_id}")
async def get_run_status(
    run_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    doc = await db["agent_runs"].find_one({"_id": run_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    return {
        "run_id":              run_id,
        "status":              doc.get("status", "unknown"),
        "discrepancies_found": doc.get("discrepancies_found", 0),
        "started_at":          doc.get("started_at"),
        "completed_at":        doc.get("completed_at"),
        "error":               doc.get("error"),
        "steps":               doc.get("steps", []),
    }
