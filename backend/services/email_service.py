import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from core.config import settings
import logging

logger = logging.getLogger(__name__)


class EmailService:
    async def send_reconciliation_email(self, discrepancy: dict) -> bool:
        """Send the AI-drafted reconciliation email to the counterparty accounting officer."""
        recipient_email = discrepancy.get("recipient_email", "")
        if not recipient_email:
            logger.warning(f"No recipient email for discrepancy {discrepancy.get('id')} — skipping send.")
            return False

        message = MIMEMultipart("alternative")
        message["Subject"] = f"Reconciliation Notice — Ref: {discrepancy.get('ledger_ref', '')}"
        message["From"] = settings.EMAIL_FROM
        message["To"] = recipient_email
        message.attach(MIMEText(discrepancy.get("email_draft", ""), "plain", "utf-8"))

        try:
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USER,
                password=settings.SMTP_PASSWORD,
                start_tls=True,
            )
            logger.info(f"Reconciliation email sent to {recipient_email} for ref {discrepancy.get('ledger_ref')}")
            return True
        except Exception as e:
            logger.error(f"Failed to send email: {e}")
            return False
