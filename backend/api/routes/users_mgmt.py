"""
User & Role management routes.

GET    /api/v1/users/              — list all users
POST   /api/v1/users/              — create user
PATCH  /api/v1/users/{id}          — update user
DELETE /api/v1/users/{id}          — delete user

GET    /api/v1/users/roles         — list all roles
POST   /api/v1/users/roles         — create custom role
PATCH  /api/v1/users/roles/{id}    — update custom role
DELETE /api/v1/users/roles/{id}    — delete custom role
"""

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import List

from api.dependencies import get_db, require_permission
from models.user import UserCreate, UserUpdate, RoleCreate
from services.user_service import UserService

router = APIRouter()


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_users(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.view")),
):
    return await UserService(db).list_users()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.manage")),
):
    try:
        return await UserService(db).create_user(payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    payload: UserUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.manage")),
):
    updated = await UserService(db).update_user(user_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return updated


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.manage")),
):
    deleted = await UserService(db).delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")


# ── Roles ─────────────────────────────────────────────────────────────────────

@router.get("/roles")
async def list_roles(
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.view")),
):
    return await UserService(db).list_roles()


@router.post("/roles", status_code=status.HTTP_201_CREATED)
async def create_role(
    payload: RoleCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.manage")),
):
    try:
        return await UserService(db).create_role(payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.patch("/roles/{role_id}")
async def update_role(
    role_id: str,
    payload: RoleCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.manage")),
):
    try:
        updated = await UserService(db).update_role(role_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Role not found")
    return updated


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _: dict = Depends(require_permission("users.manage")),
):
    deleted = await UserService(db).delete_role(role_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Role not found or is a system role")
