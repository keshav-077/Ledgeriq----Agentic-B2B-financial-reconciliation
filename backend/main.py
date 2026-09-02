import sys
import asyncio
import logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("agent").setLevel(logging.INFO)
logging.getLogger("services").setLevel(logging.INFO)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
import os
import warnings
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from core.config import settings
from core.database import connect_to_mongo, close_mongo_connection, get_database
from core.indexes import ensure_indexes
from api.routes import (
    companies, ledgers, discrepancies, reconciliation,
    portal, reconciliations, erp_integration, search, gemini_chat,
)
from api.routes import auth as auth_routes
from api.routes import settings as settings_routes
from api.routes import users_mgmt


from fastapi.responses import JSONResponse

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # H-5 Güvenlik Yaması: Uploads klasörüne dışarıdan yetkisiz erişimi engelle
        if request.url.path.startswith("/uploads"):
            if not request.headers.get("Authorization") and "ledgeriq_session" not in request.cookies:
                return JSONResponse(status_code=401, content={"detail": "Unauthorized: Authentication required"})

        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    _insecure_defaults = ("change-me-in-production", "", "changeme")
    if settings.DEBUG and settings.SECRET_KEY in _insecure_defaults:
        warnings.warn(
            "SECRET_KEY is set to an insecure default value. "
            "Generate a strong random key before deploying with DEBUG=false.",
            RuntimeWarning,
            stacklevel=2,
        )
    await connect_to_mongo()
    await ensure_indexes(get_database())
    yield
    await close_mongo_connection()


# Ensure upload directories exist before StaticFiles mount
_uploads_dir = os.path.abspath(settings.UPLOAD_DIR)
os.makedirs(os.path.join(_uploads_dir, "logos"), exist_ok=True)


app = FastAPI(
    title="LedgerIQ API",
    description="Agentic B2B financial reconciliation platform — powered by Google Gemini and MongoDB",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)

# Serve uploaded files (logos etc.) as static assets
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(auth_routes.router,       prefix="/api/v1/auth",       tags=["Auth"])
app.include_router(settings_routes.router,   prefix="/api/v1/settings",   tags=["Settings"])
app.include_router(users_mgmt.router,        prefix="/api/v1/users",      tags=["Users"])
app.include_router(companies.router,         prefix="/api/v1/companies",  tags=["Companies"])
app.include_router(ledgers.router,           prefix="/api/v1/ledgers",    tags=["Ledgers"])
app.include_router(discrepancies.router,     prefix="/api/v1/discrepancies", tags=["Discrepancies"])
app.include_router(reconciliation.router,    prefix="/api/v1/reconciliation", tags=["Reconciliation"])
app.include_router(portal.router,            prefix="/api/v1/portal",     tags=["Portal"])
app.include_router(reconciliations.router,   prefix="/api/v1/reconciliations", tags=["Reconciliations"])
app.include_router(erp_integration.router,   prefix="/api/v1/erp",        tags=["ERP Integration"])
app.include_router(search.router,            prefix="/api/v1/search",     tags=["Search"])
app.include_router(gemini_chat.router,       prefix="/api/v1/gemini",     tags=["Gemini Chat"])


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "ledgeriq-api", "version": "0.2.0"}


# ── MongoDB MCP Server — HTTP/SSE Transport ───────────────────────────────────
# Accessible at: /mcp/sse  (real MCP protocol over HTTP, no subprocess needed)
from agent.mcp_server import create_mcp_asgi_app
app.mount("/mcp", create_mcp_asgi_app())
