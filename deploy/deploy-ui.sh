#!/bin/bash
set -e
REGION=ap-southeast-2
BUCKET=ledgeriq-deploy-095480976851-ap-southeast-2

aws s3 cp "s3://${BUCKET}/frontend-ui.tgz" /tmp/frontend-ui.tgz --region "$REGION"
tar -xzf /tmp/frontend-ui.tgz -C /opt/ledgeriq

python3 - <<'PY'
from pathlib import Path
p = Path("/opt/ledgeriq/.env")
lines = p.read_text().splitlines() if p.exists() else []
out = []
found = False
for line in lines:
    if line.startswith("ADMIN_PASSWORD="):
        out.append("ADMIN_PASSWORD=LedgerIQ-Demo")
        found = True
    else:
        out.append(line)
if not found:
    out.append("ADMIN_PASSWORD=LedgerIQ-Demo")
p.write_text("\n".join(out) + "\n")
print("ENV_PASSWORD_UPDATED")
PY

cat > /tmp/update_admin_hash.py <<'PY'
from datetime import datetime, timezone
import os

from passlib.context import CryptContext
from pymongo import MongoClient

hashed = CryptContext(schemes=["bcrypt"], deprecated="auto").hash("LedgerIQ-Demo")
uri = os.environ.get("MONGODB_URI", "mongodb://mongo:27017")
db_name = os.environ.get("MONGODB_DB_NAME", "ledgeriq_db")
client = MongoClient(uri)
result = client[db_name]["users"].update_one(
    {"username": "admin"},
    {"$set": {"password_hash": hashed, "updated_at": datetime.now(timezone.utc)}},
)
print("MATCHED", result.matched_count, "MODIFIED", result.modified_count)
if result.matched_count == 0:
    raise SystemExit("admin user not found")
PY

docker cp /tmp/update_admin_hash.py ledgeriq-backend-1:/tmp/update_admin_hash.py
docker exec ledgeriq-backend-1 python /tmp/update_admin_hash.py

cd /opt/ledgeriq
docker compose -f docker-compose.prod.yml up -d --build frontend
docker compose -f docker-compose.prod.yml restart backend
echo DEPLOY_UI_DONE
