"""
Lumina Test Data Seeder
=======================

Usage:
    cd lumina/backend
    python scripts/seed_mock_data.py
"""
import asyncio
import os
from datetime import datetime, timedelta

import motor.motor_asyncio
from dotenv import load_dotenv
from pathlib import Path
from passlib.context import CryptContext

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

MONGODB_URI     = os.getenv("MONGODB_URI",     "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "lumina_db")


def make_ledger(company_id, counterparty_id, ref, amount, tx_type, date, desc, source):
    now = datetime.utcnow()
    return {
        "company_id":       company_id,
        "counterparty_id":  counterparty_id,
        "transaction_ref":  ref,
        "transaction_type": tx_type,
        "amount":           amount,
        "currency":         "USD",
        "transaction_date": date,
        "due_date":         date + timedelta(days=30),
        "description":      desc,
        "status":           "pending",
        "source":           source,
        "raw_data":         None,
        "created_at":       now,
        "updated_at":       now,
    }


async def seed():
    client = motor.motor_asyncio.AsyncIOMotorClient(MONGODB_URI)
    db     = client[MONGODB_DB_NAME]

    # ── 0. CREATE DEMO USER ──────────────────────────────────────────────────
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    
    admin_role = await db.roles.find_one({"name": "System Administrator"})
    role_id = str(admin_role["_id"]) if admin_role else None
    
    demo_user = await db.users.find_one({"username": "demo"})
    if not demo_user:
        await db.users.insert_one({
            "username": "demo",
            "email": "demo@lumina.ai",
            "hashed_password": pwd_context.hash("lumina2026"),
            "role_id": role_id,
            "is_active": True,
            "created_at": datetime.utcnow()
        })
        print("✅ Kullanıcı oluşturuldu: username='demo' / password='lumina2026'")
    else:
        await db.users.update_one(
            {"username": "demo"},
            {"$set": {"hashed_password": pwd_context.hash("lumina2026")}}
        )
        print("✅ Kullanıcı güncellendi: username='demo' / password='lumina2026'")

    # ── 1. Find or create own company ────────────────────────────────────────
    own = await db.companies.find_one({"is_own_company": True})
    if not own:
        # company_settings'den al, companies'e upsert et
        cs = await db.company_settings.find_one({})
        if not cs:
            print("HATA: company_settings bulunamadı. Onboarding tamamlandı mı?")
            client.close()
            return
        identity = cs.get("identity", {})
        contact  = cs.get("contact",  {})
        now = datetime.utcnow()
        own_doc = {
            "name":                 identity.get("company_name", "Own Company"),
            "tax_id":               identity.get("identifier_value", ""),
            "reconciliation_email": contact.get("contact_email", ""),
            "contact_name":         contact.get("contact_name", ""),
            "is_own_company":       True,
            "status":               "active",
            "phones":               [],
            "emails":               [],
            "created_at":           now,
            "updated_at":           now,
        }
        res  = await db.companies.insert_one(own_doc)
        own_id   = str(res.inserted_id)
        own_name = own_doc["name"]
        print(f"Kendi firma companies'e eklendi: {own_name} → {own_id}")
    else:
        own_id   = str(own["_id"])
        own_name = own.get("name", "Kendi Firma")
        print(f"Kendi firma bulundu: {own_name} → {own_id}")

    # ── 2. Find counterparty (first non-own company) ─────────────────────────
    cp = await db.companies.find_one({"is_own_company": {"$ne": True}})
    if not cp:
        print("HATA: Counterparty bulunamadı.")
        print("Counterparties sayfasından en az bir karşı taraf ekle.")
        client.close()
        return

    cp_id   = str(cp["_id"])
    cp_name = cp.get("name", "Karşı Taraf")
    print(f"Karşı taraf: {cp_name} → {cp_id}")

    # ── 3. Clean up existing test ledger data ────────────────────────────────
    del_a = await db.ledgers.delete_many({
        "company_id": own_id, "counterparty_id": cp_id
    })
    del_b = await db.ledgers.delete_many({
        "company_id": cp_id, "counterparty_id": own_id
    })
    await db.discrepancies.delete_many({
        "$or": [
            {"company_a_id": own_id, "company_b_id": cp_id},
            {"company_a_id": cp_id,  "company_b_id": own_id},
        ]
    })
    print(f"Temizlendi: {del_a.deleted_count + del_b.deleted_count} ledger, discrepancies silindi.")

    base = datetime(2026, 5, 7)

    # ── 4. BİZİM STATEMENT (internal_statement) ──────────────────────────────
    our_ledgers = [
        # INV-2026-001 — AMOUNT MISMATCH: Biz $50k diyoruz
        make_ledger(own_id, cp_id, "INV-2026-001", 50_000.00, "invoice",
                    base, "Enterprise Software Licensing Q1", "internal_statement"),

        # INV-2026-002 — EŞLEŞİYOR (uyuşmazlık yok)
        make_ledger(own_id, cp_id, "INV-2026-002", 25_000.00, "invoice",
                    base + timedelta(5), "Consulting Services Feb", "internal_statement"),

        # PAY-2026-003 — MISSING RECORD: Sadece bizde var
        make_ledger(own_id, cp_id, "PAY-2026-003", 12_500.00, "payment",
                    base + timedelta(10), "Partial payment ref INV-2025-088", "internal_statement"),

        # INV-2026-004 — DATE MISMATCH: Biz 1 Nisan diyoruz
        make_ledger(own_id, cp_id, "INV-2026-004", 35_000.00, "invoice",
                    base + timedelta(14), "Infrastructure Services Q1", "internal_statement"),

        # PAY-2026-005 — EŞLEŞİYOR
        make_ledger(own_id, cp_id, "PAY-2026-005", 50_000.00, "payment",
                    base + timedelta(30), "Payment for INV-2026-001", "internal_statement"),
    ]

    # ── 5. KARŞI TARAFIN STATEMENT'I (portal upload simülasyonu) ─────────────
    their_ledgers = [
        # INV-2026-001 — AMOUNT MISMATCH: Onlar $47,500 diyor
        make_ledger(cp_id, own_id, "INV-2026-001", 47_500.00, "invoice",
                    base, "Enterprise Software Licensing Q1", "portal:seed"),

        # INV-2026-002 — EŞLEŞİYOR
        make_ledger(cp_id, own_id, "INV-2026-002", 25_000.00, "invoice",
                    base + timedelta(5), "Consulting Services Feb", "portal:seed"),

        # PAY-2026-003 — YOK (missing record)

        # INV-2026-004 — DATE MISMATCH: Onlar 8 Nisan diyor
        make_ledger(cp_id, own_id, "INV-2026-004", 35_000.00, "invoice",
                    base + timedelta(21), "Infrastructure Services Q1", "portal:seed"),

        # PAY-2026-005 — EŞLEŞİYOR
        make_ledger(cp_id, own_id, "PAY-2026-005", 50_000.00, "payment",
                    base + timedelta(30), "Payment for INV-2026-001", "portal:seed"),
    ]

    all_records = our_ledgers + their_ledgers
    result = await db.ledgers.insert_many(all_records)
    print(f"\n{len(result.inserted_ids)} ledger kaydı eklendi.")

    # ── 6. Master balance kaydını güncelle ───────────────────────────────────
    now = datetime.utcnow()
    cp_doc = await db.companies.find_one({"_id": __import__("bson").ObjectId(cp_id)})
    cp_name = cp_doc.get("name", "") if cp_doc else ""
    await db.master_balances.update_one(
        {"counterparty_id": cp_id},
        {"$set": {
            "company_id":            own_id,
            "counterparty_id":       cp_id,
            "company_name":          cp_name,
            "balance":               0.0,
            "currency":              "USD",
            "reconciliation_status": "ready_for_external",
            "updated_at":            now,
        }},
        upsert=False,
    )
    print("Master balance kaydı güncellendi (mevcut kayıt korundu).")
    print("Master balance kaydı güncellendi.")

    print("\n── Seed tamamlandı ─────────────────────────────────────────────")
    print(f"  OWN_COMPANY_ID   = {own_id}")
    print(f"  COUNTERPARTY_ID  = {cp_id}")
    print("\nBeklenen uyuşmazlıklar:")
    print("  INV-2026-001  amount_mismatch  ($50,000 vs $47,500)")
    print("  PAY-2026-003  missing_record   (karşı tarafta kayıt yok)")
    print("  INV-2026-004  date_mismatch    (14 gün fark)")
    print(f"\nReconciliation tetiklemek için:")
    print(f'  POST /api/v1/reconciliation/run?company_a_id={own_id}&company_b_id={cp_id}')

    client.close()


if __name__ == "__main__":
    asyncio.run(seed())