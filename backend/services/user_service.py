"""
User and Role management service.

Users are stored in the `users` collection.
Roles are stored in the `roles` collection.
System roles (System Administrator, Manager, IT Specialist, Staff) are seeded
automatically when the first user is created.
"""

from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from passlib.context import CryptContext

from models.user import SYSTEM_ROLES, PERMISSION_KEYS, RoleCreate, UserCreate, UserUpdate

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _serialize_user(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    doc.pop("password_hash", None)
    doc.setdefault("full_name", None)
    doc.setdefault("is_active", True)
    for field in ("created_at", "updated_at"):
        if isinstance(doc.get(field), datetime):
            doc[field] = doc[field].isoformat()
    return doc


def _serialize_role(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    doc.setdefault("is_system_role", False)
    doc.setdefault("description", None)
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


class UserService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.users = db["users"]
        self.roles = db["roles"]

    # ── Role bootstrap ─────────────────────────────────────────────────────

    async def seed_system_roles(self) -> None:
        """Insert system roles if they don't exist yet."""
        for name, perms in SYSTEM_ROLES.items():
            existing = await self.roles.find_one({"name": name})
            if not existing:
                await self.roles.insert_one({
                    "name": name,
                    "description": f"System default {name} role",
                    "permissions": perms,
                    "is_system_role": True,
                    "created_at": datetime.now(timezone.utc),
                })

    async def seed_admin_user(
        self,
        username: str,
        password: str,
        email: str,
        *,
        sync_password: bool = False,
    ) -> None:
        """Create the initial System Administrator if the users collection is empty."""
        count = await self.users.count_documents({})
        if count == 0:
            await self.seed_system_roles()
            await self.users.insert_one({
                "username": username,
                "email": email,
                "password_hash": _pwd_ctx.hash(password),
                "role": "System Administrator",
                "full_name": "System Administrator",
                "is_active": True,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            })
            return

        if sync_password:
            existing = await self.users.find_one({"username": username})
            if existing:
                await self.users.update_one(
                    {"username": username},
                    {
                        "$set": {
                            "password_hash": _pwd_ctx.hash(password),
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )

    # ── Auth ───────────────────────────────────────────────────────────────

    async def authenticate(self, username: str, password: str) -> Optional[dict]:
        """Return user dict if credentials are valid, else None."""
        doc = await self.users.find_one({"username": username, "is_active": True})
        if not doc:
            return None
            
        stored_hash = doc.get("password_hash", "")
        
        try:

            is_valid = _pwd_ctx.verify(password, stored_hash)
            if not is_valid:
                return None
        except Exception:

            return None
            
        return _serialize_user(dict(doc))

    async def get_by_id(self, user_id: str) -> Optional[dict]:
        if not ObjectId.is_valid(user_id):
            return None
        doc = await self.users.find_one({"_id": ObjectId(user_id)})
        return _serialize_user(dict(doc)) if doc else None

    # ── User CRUD ──────────────────────────────────────────────────────────

    async def list_users(self) -> List[dict]:
        docs = []
        async for doc in self.users.find():
            docs.append(_serialize_user(dict(doc)))
        return docs

    async def create_user(self, payload: UserCreate) -> dict:
        await self.seed_system_roles()
        existing = await self.users.find_one({"username": payload.username})
        if existing:
            raise ValueError(f"Username '{payload.username}' already exists")
        now = datetime.now(timezone.utc)
        doc = {
            "username": payload.username,
            "email": payload.email,
            "password_hash": _pwd_ctx.hash(payload.password),
            "role": payload.role,
            "full_name": payload.full_name,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        result = await self.users.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _serialize_user(doc)

    async def update_user(self, user_id: str, payload: UserUpdate) -> Optional[dict]:
        if not ObjectId.is_valid(user_id):
            return None
        update_data: dict = {"updated_at": datetime.now(timezone.utc)}
        if payload.email is not None:
            update_data["email"] = payload.email
        if payload.role is not None:
            update_data["role"] = payload.role
        if payload.full_name is not None:
            update_data["full_name"] = payload.full_name
        if payload.is_active is not None:
            update_data["is_active"] = payload.is_active
        if payload.password:
            update_data["password_hash"] = _pwd_ctx.hash(payload.password)
        await self.users.update_one(
            {"_id": ObjectId(user_id)}, {"$set": update_data}
        )
        doc = await self.users.find_one({"_id": ObjectId(user_id)})
        return _serialize_user(dict(doc)) if doc else None

    async def delete_user(self, user_id: str) -> bool:
        if not ObjectId.is_valid(user_id):
            return False
        result = await self.users.delete_one({"_id": ObjectId(user_id)})
        return result.deleted_count > 0

    # ── Role CRUD ──────────────────────────────────────────────────────────

    async def list_roles(self) -> List[dict]:
        await self.seed_system_roles()
        docs = []
        async for doc in self.roles.find():
            docs.append(_serialize_role(dict(doc)))
        return docs

    async def create_role(self, payload: RoleCreate) -> dict:
        existing = await self.roles.find_one({"name": payload.name})
        if existing:
            raise ValueError(f"Role '{payload.name}' already exists")
        # Fill in any missing permission keys with False
        full_perms = {k: False for k in PERMISSION_KEYS}
        full_perms.update(payload.permissions)
        doc = {
            "name": payload.name,
            "description": payload.description,
            "permissions": full_perms,
            "is_system_role": False,
            "created_at": datetime.now(timezone.utc),
        }
        result = await self.roles.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _serialize_role(doc)

    async def update_role(self, role_id: str, payload: RoleCreate) -> Optional[dict]:
        if not ObjectId.is_valid(role_id):
            return None
        # Prevent editing system roles
        existing = await self.roles.find_one({"_id": ObjectId(role_id)})
        if not existing:
            return None
        if existing.get("is_system_role"):
            raise ValueError("System roles cannot be modified")
        full_perms = {k: False for k in PERMISSION_KEYS}
        full_perms.update(payload.permissions)
        await self.roles.update_one(
            {"_id": ObjectId(role_id)},
            {"$set": {
                "name": payload.name,
                "description": payload.description,
                "permissions": full_perms,
            }},
        )
        doc = await self.roles.find_one({"_id": ObjectId(role_id)})
        return _serialize_role(dict(doc)) if doc else None

    async def delete_role(self, role_id: str) -> bool:
        if not ObjectId.is_valid(role_id):
            return False
        existing = await self.roles.find_one({"_id": ObjectId(role_id)})
        if not existing or existing.get("is_system_role"):
            return False
        result = await self.roles.delete_one({"_id": ObjectId(role_id)})
        return result.deleted_count > 0

    async def get_role_permissions(self, role_name: str) -> dict:
        """Return the permission dict for a given role name."""
        # Check system roles first
        if role_name in SYSTEM_ROLES:
            return SYSTEM_ROLES[role_name]
        doc = await self.roles.find_one({"name": role_name})
        if doc:
            return doc.get("permissions", {})
        return {}
