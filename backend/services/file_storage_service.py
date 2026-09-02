"""
File Storage Service
====================
Saves uploaded files to disk under UPLOAD_DIR/{source}/{storage_id}_{filename}
and tracks metadata in the MongoDB `file_objects` collection.

Windows-safe: os.makedirs + pathlib throughout; no symlinks.
"""
import os
import re
import logging
from datetime import datetime
from typing import Optional, Tuple
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId

logger = logging.getLogger(__name__)


class FileStorageService:
    def __init__(self, db: AsyncIOMotorDatabase, upload_dir: str):
        self.db = db
        self.collection = db["file_objects"]
        self.upload_dir = upload_dir

    async def save_file(
        self,
        file_bytes: bytes,
        original_filename: str,
        source: str,
        counterparty_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """
        Persist file bytes to disk.  Returns the storage_id string.
        source examples: "portal", "internal_statement", "global_statement"
        """
        storage_id = str(ObjectId())
        category_dir = os.path.join(self.upload_dir, source)
        os.makedirs(category_dir, exist_ok=True)

        # Strip path-traversal characters; keep alphanumerics, dots, dashes, underscores
        sanitized_name = re.sub(r'[^\w.\-]', '_', original_filename)
        safe_name = f"{storage_id}_{sanitized_name}"
        file_path = os.path.join(category_dir, safe_name)

        with open(file_path, "wb") as fh:
            fh.write(file_bytes)

        doc = {
            "_id": ObjectId(storage_id),
            "filename": original_filename,
            "file_path": file_path,
            "source": source,
            "size": len(file_bytes),
            "counterparty_id": counterparty_id,
            "metadata": metadata or {},
            "created_at": datetime.utcnow(),
        }
        await self.collection.insert_one(doc)
        logger.info("[FileStorage] saved '%s' → %s", original_filename, file_path)
        return storage_id

    async def get_file(self, storage_id: str) -> Optional[Tuple[str, bytes]]:
        """Returns (original_filename, bytes) or None if not found / missing from disk."""
        if not ObjectId.is_valid(storage_id):
            return None
        doc = await self.collection.find_one({"_id": ObjectId(storage_id)})
        if not doc:
            return None
        try:
            with open(doc["file_path"], "rb") as fh:
                data = fh.read()
            return doc["filename"], data
        except FileNotFoundError:
            logger.warning("[FileStorage] file missing on disk: %s", doc["file_path"])
            return None

    async def get_metadata(self, storage_id: str) -> Optional[dict]:
        if not ObjectId.is_valid(storage_id):
            return None
        doc = await self.collection.find_one({"_id": ObjectId(storage_id)})
        if doc:
            doc["id"] = str(doc.pop("_id"))
        return doc

    async def delete_file(self, storage_id: str) -> bool:
        """Remove file from disk + MongoDB. Returns True if the record existed."""
        if not ObjectId.is_valid(storage_id):
            return False
        doc = await self.collection.find_one_and_delete({"_id": ObjectId(storage_id)})
        if not doc:
            return False
        try:
            os.remove(doc["file_path"])
        except (FileNotFoundError, OSError) as exc:
            logger.warning("[FileStorage] could not remove file: %s", exc)
        return True

    async def list_by_source(self, source: str) -> list[dict]:
        docs = []
        async for doc in self.collection.find(
            {"source": source}, sort=[("created_at", -1)]
        ):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    async def list_by_counterparty(self, counterparty_id: str) -> list[dict]:
        docs = []
        async for doc in self.collection.find(
            {"counterparty_id": counterparty_id}, sort=[("created_at", -1)]
        ):
            doc["id"] = str(doc.pop("_id"))
            docs.append(doc)
        return docs

    async def delete_by_counterparty(self, counterparty_id: str) -> int:
        """Delete all file objects for a counterparty from disk + DB."""
        file_docs = []
        async for doc in self.collection.find({"counterparty_id": counterparty_id}):
            file_docs.append(doc)
        for fdoc in file_docs:
            try:
                os.remove(fdoc["file_path"])
            except (FileNotFoundError, OSError):
                pass
        result = await self.collection.delete_many({"counterparty_id": counterparty_id})
        return result.deleted_count
