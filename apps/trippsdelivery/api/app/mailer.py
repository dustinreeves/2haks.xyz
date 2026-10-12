"""Tell Tripp about a new order by SMTP.

Only runs when SMTP_HOST is set. Without it the API reports `emailed: false` and the web
page sends the email itself through FormSubmit (which refuses requests from servers).
Failures are logged, never raised: the order is already saved.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

log = logging.getLogger("trippsdelivery.mail")

NOTIFY_TO = os.environ.get("NOTIFY_TO", "trippreeves@gmail.com")


def describe(order: dict) -> str:
    parts = []
    if order["water"]:
        parts.append(f"{order['water']} x Water")
    if order["dog"]:
        parts.append(f"{order['dog']} x Dog sitting")
    if order["lawn"]:
        parts.append(f"{order['lawn']} x Lawn mowing")
    return ", ".join(parts)


def _send_smtp(order: dict) -> None:
    msg = EmailMessage()
    msg["Subject"] = f"Tripp's Delivery order #{order['id']} from {order['name']}"
    msg["From"] = os.environ.get("SMTP_FROM", os.environ["SMTP_USER"])
    msg["To"] = NOTIFY_TO
    msg.set_content(f"Name: {order['name']}\nOrder: {describe(order)}\nTotal: ${order['total']}\n")
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587")), timeout=15) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(msg)


def notify(order: dict) -> bool:
    """Return True if the email went out."""
    if not os.environ.get("SMTP_HOST"):
        return False
    try:
        _send_smtp(order)
        return True
    except Exception as exc:  # noqa: BLE001 - never lose an order over an email problem
        log.warning("could not email order %s: %s", order["id"], exc)
        return False
