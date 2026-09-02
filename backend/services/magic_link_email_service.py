import aiosmtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from core.config import settings

logger = logging.getLogger(__name__)


class MagicLinkEmailService:
    async def send_magic_link(
        self,
        counterparty_name: str,
        initiating_company_name: str,
        recipient_email: str,
        token: str,
        frontend_base_url: str,
    ) -> bool:
        portal_url = f"{frontend_base_url}/portal/reconcile?token={token}"

        plain_body = (
            f"Dear {counterparty_name},\n\n"
            f"Your end-of-period reconciliation process with {initiating_company_name} has started. "
            f"Please click the link below to access the secure reconciliation portal and upload "
            f"your ledger statement:\n\n{portal_url}\n\n"
            f"This link is valid for 72 hours. "
            f"For security reasons, do not share this link with others."
        )

        html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0A1016;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;background:#141D26;border-radius:16px;
               border:1px solid rgba(255,255,255,0.12);overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.12);">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background:rgba(255,255,255,0.08);
                             border:1px solid rgba(255,255,255,0.12);border-radius:10px;
                             text-align:center;vertical-align:middle;">
                    <span style="color:#FFFFFF;font-size:18px;line-height:36px;">&#9670;</span>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <p style="margin:0;font-size:15px;font-weight:700;color:#FFFFFF;">LedgerIQ</p>
                    <p style="margin:0;font-size:10px;color:#8e9192;text-transform:uppercase;
                               letter-spacing:0.12em;">Agentic Reconciliation Platform</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FFFFFF;">
                Reconciliation Invitation
              </h2>
              <p style="margin:0 0 24px;font-size:13px;color:#5C7A93;">
                End-of-period reconciliation process initiated
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#94A3B8;line-height:1.7;">
                Dear <strong style="color:#FFFFFF;">{counterparty_name}</strong>,<br><br>
                Your end-of-period reconciliation process with
                <strong style="color:#FFFFFF;"> {initiating_company_name}</strong> has started.
                Please click the button below to access the secure portal and upload your ledger
                statement.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:32px 0;">
                <tr>
                  <td style="background:#ffffff;border-radius:999px;">
                    <a href="{portal_url}"
                       style="display:inline-block;padding:14px 36px;color:#2f3131;
                              text-decoration:none;font-weight:600;font-size:14px;">
                      Open Reconciliation Portal &#8594;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid rgba(255,255,255,0.12);">
              <p style="margin:0;font-size:12px;color:#8e9192;line-height:1.6;">
                This link is valid for <strong style="color:#c4c7c8;">72 hours</strong>.
                For security reasons, do not share this link with others.<br>
                If the button above does not work, copy and paste this URL:<br>
                <span style="color:#bec8d2;word-break:break-all;">{portal_url}</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

        message = MIMEMultipart("alternative")
        message["Subject"] = f"Reconciliation Invitation — {initiating_company_name}"
        message["From"] = settings.EMAIL_FROM
        message["To"] = recipient_email
        message.attach(MIMEText(plain_body, "plain", "utf-8"))
        message.attach(MIMEText(html_body, "html", "utf-8"))

        if not settings.SMTP_USER:
            logger.warning(
                f"[MagicLink] SMTP not configured — skipping email send.\n"
                f"  Recipient : {recipient_email}\n"
                f"  Portal URL: {portal_url}"
            )
            return True

        try:
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USER,
                password=settings.SMTP_PASSWORD,
                start_tls=True,
            )
            logger.info(f"[MagicLink] Sent to {recipient_email}")
            return True
        except Exception as e:
            logger.error(f"[MagicLink] Send failed: {e} — falling back to console output")
            print("\n" + "=" * 70)
            print(" MAGIC LINK CREATED — EMAIL DELIVERY SKIPPED (SMTP not configured)")
            print(f" Recipient : {recipient_email}")
            print(f" Portal URL: {portal_url}")
            print("=" * 70 + "\n")
            return True
