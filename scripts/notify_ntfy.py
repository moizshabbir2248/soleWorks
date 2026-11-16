"""
Dark Luxury Store - ntfy.sh Order Notification Script

Sends automated order notifications to an ntfy.sh topic via HTTP POST.
Requires: pip install requests python-dotenv
"""

import json
import os

import requests
from dotenv import load_dotenv


load_dotenv()

NTFY_BASE_URL = os.getenv("NTFY_BASE_URL", "https://ntfy.sh").rstrip("/")
DEFAULT_TOPIC = os.getenv("NTFY_TOPIC", "")
DEFAULT_TIMEOUT = int(os.getenv("NTFY_TIMEOUT", "10"))


def format_items(items):
    """Format order items into readable lines with quantities."""
    if not items:
        return "- No items"

    lines = []
    for item in items:
        if isinstance(item, dict):
            name = item.get("name") or item.get("title") or "Item"
            qty = item.get("quantity", item.get("qty", 1))
            size = item.get("size")
            price = item.get("price")
            line = f"- {name}"
            if size not in (None, ""):
                line += f" (Size: {size})"
            line += f" x{qty}"
            if price is not None:
                line += f" (Rs. {price})"
            lines.append(line)
        else:
            lines.append(f"- {item}")
    return "\n".join(lines)


def _format_amount(value):
    if value is None or value == "":
        return "N/A"
    try:
        return f"Rs. {float(value):,.2f}"
    except (TypeError, ValueError):
        return f"Rs. {value}"


def build_message(order):
    """Build a clean, readable ntfy notification body for an order."""
    order = order or {}
    order_id = order.get("order_id", order.get("id", "N/A"))
    customer_name = order.get("customer_name", order.get("name", "N/A"))
    phone = order.get("phone_number", order.get("phone", "N/A"))
    email = order.get("email", "N/A")
    city = order.get("city", "N/A")
    address = order.get("delivery_address") or order.get("address") or "N/A"
    items = order.get("items", [])
    total = order.get("total_amount", order.get("total"))
    payment_method = order.get("payment_method")

    lines = [
        "New Order Received",
        "",
        f"Order ID: {order_id}",
        f"Customer Name: {customer_name}",
        f"Phone Number: {phone}",
        f"Email: {email}",
        f"City: {city}",
        f"Complete Delivery Address: {address}",
        "",
        "Ordered Items:",
        format_items(items),
        "",
        f"Total Amount: {_format_amount(total)}",
    ]
    if payment_method not in (None, ""):
        lines.append(f"Payment Method: {payment_method}")
    return "\n".join(lines)


def send_order_notification(topic=None, order=None, order_id=None, customer_name=None, items=None, total=None, timeout=None, **extra):
    """
    Send an order notification to ntfy.sh.

    Accepts either a full `order` dict (recommended) or individual fields.

    Args:
        topic (str|None): Your ntfy.sh topic name. Defaults to NTFY_TOPIC from .env.
        order (dict|None): Order details dict. May include order_id/id, customer_name/name,
            phone_number/phone, email, city, delivery_address/address, items,
            total_amount/total, payment_method.
        order_id, customer_name, items, total: Individual fields (used if `order` not provided).
        timeout (int|None): Request timeout in seconds. Defaults to NTFY_TIMEOUT.
        **extra: Additional fields (phone_number, email, city, delivery_address, payment_method).

    Returns:
        dict: {"success": bool, "message": str, "response": dict|None}
    """
    if topic is None:
        topic = DEFAULT_TOPIC

    if not topic:
        return {
            "success": False,
            "message": "NTFY topic is missing. Set NTFY_TOPIC in your .env file.",
            "response": None,
        }

    if timeout is None:
        timeout = DEFAULT_TIMEOUT

    if order is None:
        order = {
            "order_id": order_id,
            "customer_name": customer_name,
            "items": items or [],
            "total_amount": total,
        }
        order.update({k: v for k, v in extra.items() if v is not None})
    else:
        # Allow overrides passed alongside a full order dict
        overrides = {"order_id": order_id, "customer_name": customer_name, "items": items, "total_amount": total}
        overrides.update(extra)
        merged = dict(order)
        for k, v in overrides.items():
            if v is not None:
                merged[k] = v
        order = merged

    oid = order.get("order_id", order.get("id", "N/A"))
    url = f"{NTFY_BASE_URL}/{topic}"
    message_body = build_message(order)

    headers = {
        "Title": f"Dark Luxury Store - Order #{oid}",
        "Priority": "high",
        "Tags": "shopping_bags,package",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Order-Payload": json.dumps(order, ensure_ascii=False, default=str),
    }

    try:
        response = requests.post(
            url,
            data=message_body.encode("utf-8"),
            headers=headers,
            timeout=timeout,
        )
        response.raise_for_status()

        try:
            response_data = response.json()
        except ValueError:
            response_data = {"text": response.text}

        return {
            "success": True,
            "message": f"Notification sent successfully for order #{oid}.",
            "response": response_data,
        }

    except requests.exceptions.Timeout:
        return {
            "success": False,
            "message": "Request timed out while sending notification.",
            "response": None,
        }
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "message": f"Connection error: could not reach {NTFY_BASE_URL}.",
            "response": None,
        }
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code if e.response is not None else "unknown"
        details = e.response.text if e.response is not None else str(e)
        return {
            "success": False,
            "message": f"HTTP error {status_code} while sending notification: {details}",
            "response": None,
        }
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "message": f"Unexpected request error: {e}",
            "response": None,
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Unexpected error: {e}",
            "response": None,
        }


if __name__ == "__main__":
    # Example usage - replace with your actual order data and topic
    TOPIC = DEFAULT_TOPIC

    if not TOPIC:
        print("Failed: NTFY_TOPIC is not set. Add it to your .env file and try again.")
    else:
        sample_order = {
            "order_id": "TEST-1024",
            "customer_name": "Test Customer",
            "phone_number": "+92 300 1234567",
            "email": "test@example.com",
            "city": "Karachi",
            "delivery_address": "House 12, Street 5, DHA Phase 6, Karachi",
            "items": [
                {"name": "Leather Loafers", "quantity": 1, "price": 8500, "size": 42},
                {"name": "Classic Belt", "quantity": 1, "price": 2500},
            ],
            "total_amount": 11000,
            "payment_method": "Cash on Delivery",
        }

        result = send_order_notification(topic=TOPIC, order=sample_order)

        if result["success"]:
            print(result["message"])
        else:
            print(f"Failed: {result['message']}")
