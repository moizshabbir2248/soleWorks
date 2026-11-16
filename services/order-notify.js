require("dotenv").config();

function formatRs(n) {
  const v = Number(n) || 0;
  return "Rs. " + v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "- No items";
  return items
    .map((it) => {
      const title = (it && (it.title || it.name)) || "Item";
      const qty = it && it.quantity != null ? it.quantity : 1;
      const size = it && it.size != null && String(it.size).trim() ? ` (Size: ${it.size})` : "";
      const price = it && it.price != null ? ` - ${formatRs(it.price)}` : "";
      return `- ${title}${size} x${qty}${price}`;
    })
    .join("\n");
}

function fullAddress(order) {
  const parts = [order.address, order.city, order.postal_code].filter((v) => v != null && String(v).trim() !== "");
  return parts.length ? parts.join(", ") : "N/A";
}

function paymentLabel(method) {
  const m = String(method || "").toLowerCase();
  if (m === "cod_advance") return "Cash on Delivery (Rs. 500 Advance)";
  if (m === "bank_transfer" || m === "online") return "Online Bank Payment";
  if (m === "local_pickup") return "Local Area Pickup";
  return method || "N/A";
}

function buildNtfyMessage(order) {
  const items = formatItems(order.items);
  const lines = [
    "New Order Received",
    "",
    `Order ID: ${order.id != null ? order.id : "N/A"}`,
    `Customer Name: ${order.customer_name || "N/A"}`,
    `Phone Number: ${order.phone || "N/A"}`,
    `Email: ${order.email || "N/A"}`,
    `City: ${order.city || "N/A"}`,
    `Complete Delivery Address: ${fullAddress(order)}`,
    "",
    "Ordered Items:",
    items,
    "",
  ];
  const hasDelivery = order.delivery_charges != null && order.delivery_charges !== "";
  if (hasDelivery) {
    const subtotal = (Number(order.total_amount) || 0) - (Number(order.delivery_charges) || 0);
    lines.push(`Subtotal: ${formatRs(subtotal)}`);
    lines.push(`Delivery Charges: ${formatRs(order.delivery_charges)}`);
  }
  lines.push(`Total Amount: ${formatRs(order.total_amount)}`);
  if (order.payment_method) lines.push(`Payment Method: ${paymentLabel(order.payment_method)}`);
  return lines.join("\n");
}

async function sendNtfy(order) {
  const base = String(process.env.NTFY_BASE_URL || "https://ntfy.sh").trim().replace(/\/+$/, "");
  const topic = String(process.env.NTFY_TOPIC || "").trim();
  const timeoutSec = Number(process.env.NTFY_TIMEOUT || 10);
  const logPrefix = `[order-notify #${order && order.id}]`;

  if (!topic) {
    console.error(`${logPrefix} ntfy skipped: NTFY_TOPIC is not set in environment.`);
    return null;
  }

  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 10000;
  const url = `${base}/${encodeURIComponent(topic)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Title": `Dark Luxury Store - Order #${order.id}`,
        "Priority": "low",
        "Tags": "shopping_bags,package",
      },
      body: buildNtfyMessage(order),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ntfy HTTP ${res.status} at ${url}${text ? `: ${text}` : ""}`);
    }
    console.log(`${logPrefix} ntfy notification sent to ${url}`);
    return { ntfy: true, url };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`${logPrefix} ntfy request failed (${url}): ${msg}`);
    if (err && err.stack) console.error(err.stack);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sendOrderNotification(order) {
  const topic = String(process.env.NTFY_TOPIC || "").trim();
  const logPrefix = `[order-notify #${order && order.id}]`;
  if (!topic) {
    console.error(`${logPrefix} ntfy skipped: NTFY_TOPIC is not set in environment.`);
    return null;
  }
  try {
    return await sendNtfy(order);
  } catch (err) {
    console.error(`${logPrefix} ntfy notification failed:`, err && err.message ? err.message : err);
    return null;
  }
}

function buildCancelMessage(order) {
  const items = Array.isArray(order && order.items) && order.items.length
    ? order.items.map((it) => {
        const title = (it && (it.title || it.name)) || "Item";
        const size = it && it.size != null && String(it.size).trim() ? ` (Size: ${it.size})` : "";
        const qty = it && it.quantity != null ? it.quantity : 1;
        return `- ${title}${size} x${qty}`;
      }).join("\n")
    : "- No items";
  return [
    `You cancelled Order #${order && order.id != null ? order.id : "N/A"}`,
    "",
    `Customer Name: ${(order && order.customer_name) || "N/A"}`,
    `Phone: ${(order && order.phone) || "N/A"}`,
    `City: ${(order && order.city) || "N/A"}`,
    "",
    "Items:",
    items,
    "",
    `Total Amount: ${formatRs(order && order.total_amount)}`,
  ].join("\n");
}

async function sendCancelNotification(order) {
  const base = String(process.env.NTFY_BASE_URL || "https://ntfy.sh").trim().replace(/\/+$/, "");
  const topic = String(process.env.NTFY_TOPIC || "").trim();
  const timeoutSec = Number(process.env.NTFY_TIMEOUT || 10);
  const logPrefix = `[order-cancel-notify #${order && order.id}]`;

  if (!topic) {
    console.error(`${logPrefix} ntfy skipped: NTFY_TOPIC is not set in environment.`);
    return null;
  }

  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 10000;
  const url = `${base}/${encodeURIComponent(topic)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Title": "Order Cancelled by Admin",
        "Priority": "low",
        "Tags": "x,package",
      },
      body: buildCancelMessage(order),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ntfy HTTP ${res.status} at ${url}${text ? `: ${text}` : ""}`);
    }
    console.log(`${logPrefix} ntfy cancel notification sent to ${url}`);
    return { ntfy: true, url };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`${logPrefix} ntfy request failed (${url}): ${msg}`);
    if (err && err.stack) console.error(err.stack);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendOrderNotification, sendNtfy, buildNtfyMessage, sendCancelNotification, buildCancelMessage };