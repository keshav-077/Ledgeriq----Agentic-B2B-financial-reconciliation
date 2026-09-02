import motor.motor_asyncio
from core.config import settings

_client: motor.motor_asyncio.AsyncIOMotorClient = None
_db: motor.motor_asyncio.AsyncIOMotorDatabase = None


async def connect_to_mongo():
    global _client, _db
    # Use thread-pool executor loop policy on Windows to prevent TCP reset errors
    import certifi
    _client = motor.motor_asyncio.AsyncIOMotorClient(
        settings.MONGODB_URI,
        serverSelectionTimeoutMS=20000,
        tlsCAFile=certifi.where(),
        maxPoolSize=50,
        minPoolSize=5,
        maxIdleTimeMS=60_000,
        waitQueueTimeoutMS=10_000,
    )
    _db = _client[settings.MONGODB_DB_NAME]
    await _client.admin.command("ping")
    print(f"[LedgerIQ] Connected to MongoDB: {settings.MONGODB_DB_NAME}")


async def close_mongo_connection():
    global _client
    if _client:
        _client.close()
        print("[LedgerIQ] MongoDB connection closed.")


def get_database() -> motor.motor_asyncio.AsyncIOMotorDatabase:
    return _db


def get_collection(name: str):
    return _db[name]
