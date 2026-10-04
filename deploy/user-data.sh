#!/bin/bash
set -euxo pipefail
exec > >(tee /var/log/ledgeriq-bootstrap.log) 2>&1

dnf update -y
dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

if ! swapon --show | grep -q swapfile; then
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

TOKEN=""
for _ in $(seq 1 30); do
  TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" || true)
  if [ -n "$TOKEN" ]; then
    break
  fi
  sleep 2
done

PUBLIC_IP=$(curl -sS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
REGION=ap-southeast-2
BUCKET=ledgeriq-deploy-095480976851-ap-southeast-2

aws s3 cp "s3://${BUCKET}/ledgeriq-src.tgz" /opt/ledgeriq.tgz
mkdir -p /opt/ledgeriq
tar -xzf /opt/ledgeriq.tgz -C /opt/ledgeriq

SECRET_KEY=$(aws ssm get-parameter --name /ledgeriq/secret-key --with-decryption --query Parameter.Value --output text --region "$REGION")
ADMIN_PASSWORD=$(aws ssm get-parameter --name /ledgeriq/admin-password --with-decryption --query Parameter.Value --output text --region "$REGION")
GEMINI_API_KEY=$(aws ssm get-parameter --name /ledgeriq/gemini-api-key --with-decryption --query Parameter.Value --output text --region "$REGION" || true)

cat > /opt/ledgeriq/.env <<EOF
MONGODB_URI=mongodb://mongo:27017
MONGODB_DB_NAME=ledgeriq_db
SECRET_KEY=${SECRET_KEY}
DEBUG=false
FRONTEND_BASE_URL=http://${PUBLIC_IP}
ALLOWED_ORIGINS=http://${PUBLIC_IP}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_EMAIL=admin@ledgeriq.local
GEMINI_API_KEY=${GEMINI_API_KEY}
GEMINI_MODEL=gemini-3-flash-preview
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=noreply@ledgeriq.local
EOF

cd /opt/ledgeriq
docker compose -f docker-compose.prod.yml up -d --build
echo "BOOTSTRAP_DONE $(date -u)" >> /var/log/ledgeriq-bootstrap.log
