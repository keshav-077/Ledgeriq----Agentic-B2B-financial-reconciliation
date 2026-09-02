"""
Email Composer — Jinja2 template helpers for structured email prompting.
Used by GeminiAgent to provide a consistent format hint in its prompts.
"""
from jinja2 import Template

RECONCILIATION_EMAIL_TEMPLATE = """\
Dear {{ recipient_name }},

As the Accounting Department of {{ company_a_name }}, we are writing regarding \
transaction reference {{ ledger_ref }} and would like to initiate a reconciliation request.

According to our records, the transaction details are as follows:
  - Transaction Amount : {{ amount_a | float | round(2) }} {{ currency }}
  - Transaction Date   : {{ transaction_date }}
  - Transaction Type   : {{ transaction_type }}

However, the amount recorded on your side for this transaction appears to be \
{{ amount_b | float | round(2) }} {{ currency }}. We kindly request that the \
discrepancy of {{ difference | float | round(2) }} {{ currency }} be reviewed \
and that we receive your written confirmation.

Yours sincerely,
{{ contact_name }}
{{ company_a_name }} — Accounting Department
"""


def render_email_template(context: dict) -> str:
    return Template(RECONCILIATION_EMAIL_TEMPLATE).render(**context)
