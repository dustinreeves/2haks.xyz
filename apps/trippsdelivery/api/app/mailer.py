"""Tell Tripp about a new order.

Two optional channels, each switched on by its environment variables:
  - ntfy.sh push notification when NTFY_TOPIC is set
  - SMTP email when SMTP_HOST is set
If neither works the API reports `emailed: false` and the web page falls back to FormSubmit
(which refuses requests from servers). Failures are logged, never raised: the order is saved.
"""

from __future__ import annotations

import json
import logging
import os
import smtplib
import urllib.request
from email.message import EmailMessage

log = logging.getLogger("trippsdelivery.mail")

NOTIFY_TO = os.environ.get("NOTIFY_TO", "trippreeves@gmail.com")


def describe(order: dict) -> str:
    parts = []
    if order["water"]:
        parts.append(f"{order['water']} x Water")
    if order["dog"]:
        parts.append(f"{order['dog']} x Dog sitting (2 days each)")
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


def _send_ntfy(order: dict) -> None:
    body = json.dumps(
        {
            "topic": os.environ["NTFY_TOPIC"],
            "title": f"New order #{order['id']} from {order['name']}",
            "message": f"{describe(order)}\nTotal: ${order['total']}",
            "tags": ["moneybag"],
        }
    ).encode()
    req = urllib.request.Request("https://ntfy.sh/", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()


def notify(order: dict) -> bool:
    """Tell Tripp by every channel that is set up. True if at least one worked."""
    sent = False
    for enabled, send, label in (
        (os.environ.get("SMTP_HOST"), _send_smtp, "email"),
        (os.environ.get("NTFY_TOPIC"), _send_ntfy, "ntfy"),
    ):
        if not enabled:
            continue
        try:
            send(order)
            sent = True
        except Exception as exc:  # noqa: BLE001 - never lose an order over a notification problem
            log.warning("could not send %s for order %s: %s", label, order["id"], exc)
    return sent
