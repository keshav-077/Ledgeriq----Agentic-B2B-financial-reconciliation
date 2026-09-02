"""
Lumina Full Clean Script
Run : python scripts/full_clean.py
"""
import asyncio
import os
import sys
from pathlib import Path

script_path = Path(__file__).resolve()
backend_dir = script_path.parent.parent / "backend"

if not backend_dir.exists():
    backend_dir = script_path.parent

sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

import certifi
import motor.motor_asyncio

MONGODB_URI     = os.getenv("MONGODB_URI", "")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "lumina_db")

async def main():
    if not MONGODB_URI:
        print("HATA: MONGODB_URI bulunamadı. backend/.env dosyası doğru yerde mi?")
        return

    print("⚡ MongoDB Atlas'a atomik temizlik için bağlanılıyor...")
    
    client = motor.motor_asyncio.AsyncIOMotorClient(
        MONGODB_URI,
        tlsCAFile=certifi.where(),
    )
    db = client[MONGODB_DB_NAME]

    target_collections = [
        "ledgers",
        "discrepancies",
        "agent_runs",
        "companies",
        "master_balances",
        "reconciliation_sessions",
        "global_statements",
        "file_objects"
    ]

    try:
        available_collections = await db.list_collection_names()
        print(f"\n🚀 NÜKLEER TEMİZLİK BAŞLADI ({MONGODB_DB_NAME}):")
        print("-" * 50)

        for col_name in target_collections:
            if col_name in available_collections:

                if col_name in ["users", "accounts", "admin"]:
                    continue
                    
                res = await db[col_name].delete_many({})
                print(f" 💥 {col_name.ljust(25)}: {res.deleted_count} kayıt kökünden silindi.")
            else:
                print(f" 🔍 {col_name.ljust(25)}: Koleksiyon zaten boş veya yok.")

        print("-" * 50)
        print("Full clean ok.")
        
    except Exception as e:
        print(f"\n❌ Atomik Temizlik Hatası: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    asyncio.run(main())