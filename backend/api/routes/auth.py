"""
Backend authentication routes.

POST /api/v1/auth/login      — returns JWT access token (public)
GET  /api/v1/auth/me         — returns current user (requires Bearer token)
POST /api/v1/auth/seed-admin — seeds initial admin user (requires settings.edit permission)
"""

import time
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Request, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from api.dependencies import get_db, get_current_user, require_permission
from core.auth import create_access_token
from core.config import settings
from models.user import LoginRequest, TokenResponse, UserCreate
from services.user_service import UserService

router = APIRouter()

# Simple in-memory rate limiter (resets on process restart; suitable for single-worker deployments)
_login_attempt_times: defaultdict = defaultdict(list)
_RATE_LIMIT_MAX = 10
_RATE_LIMIT_WINDOW = 60  # seconds


def _is_rate_limited(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _login_attempt_times[ip] if now - t < _RATE_LIMIT_WINDOW]
    _login_attempt_times[ip] = recent
    if len(recent) >= _RATE_LIMIT_MAX:
        return True
    _login_attempt_times[ip].append(now)
    return False


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, payload: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    if _is_rate_limited(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again in a minute.",
        )
    svc = UserService(db)

    admin_username = settings.ADMIN_USERNAME
    admin_password = settings.ADMIN_PASSWORD
    if not admin_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_PASSWORD (or LUMINA_PASSWORD) must be set to seed the admin user.",
        )
    admin_email = settings.ADMIN_EMAIL
    await svc.seed_admin_user(
        admin_username,
        admin_password,
        admin_email,
        sync_password=settings.DEBUG,
    )

    user = await svc.authenticate(payload.username, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token(user["id"], user["role"])
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.post("/seed-admin", status_code=status.HTTP_200_OK)
async def seed_admin(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("settings.edit")),
):
    """Explicitly seed the admin user (idempotent — safe to call multiple times).
    Requires System Administrator permissions."""
    svc = UserService(db)
    admin_username = settings.ADMIN_USERNAME
    admin_password = settings.ADMIN_PASSWORD
    if not admin_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_PASSWORD (or LUMINA_PASSWORD) must be set to seed the admin user.",
        )
    admin_email = settings.ADMIN_EMAIL
    await svc.seed_system_roles()
    await svc.seed_admin_user(
        admin_username,
        admin_password,
        admin_email,
        sync_password=settings.DEBUG,
    )
    return {"message": "Admin user and system roles seeded successfully"}
