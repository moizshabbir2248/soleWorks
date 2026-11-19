const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/auth");
const { sendNtfy, sendCancelNotification } = require("../services/order-notify");

const router = express.Router();

// Supported storefront payment methods and their delivery charge (PKR).
const PAYMENT_METHODS = {
  cod_advance: { delivery_charges: 500, label: "Cash on Delivery (Rs. 500 Advance)" },
  bank_transfer: { delivery_charges: 500, label: "Online Bank Payment" },
  local_pickup: { delivery_charges: 0, label: "Local Area Pickup" },
};

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

const MAX_ITEMS = 25;
const MAX_TOTAL = 10000000; // Rs. 10,000,000 sanity cap

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function stringField(value, maxLen) {
  return value != null ? String(value).trim().slice(0, maxLen) : "";
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return "Rs. " + Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function normalizeCouponCode(value) {
  return stringField(value, 60).toUpperCase();
}

function couponDiscountFor(coupon, subtotal) {
  const type = String(coupon.discount_type || "").toLowerCase();
  const value = Number(coupon.discount_value);
  if (!Number.isFinite(value) || value <= 0) {
    throw httpError(500, "Coupon has an invalid discount value.");
  }
  if (type !== "fixed" && type !== "percentage") {
    throw httpError(500, "Coupon has an invalid discount type.");
  }
  const rawDiscount = type === "percentage"
    ? subtotal * Math.min(value, 100) / 100
    : Math.min(value, subtotal);
  return roundMoney(Math.max(0, Math.min(rawDiscount, subtotal)));
}

function validateCouponForSubtotal(coupon, subtotal) {
  if (!coupon.active) throw httpError(400, "This coupon is not active.");
  if (coupon.expires_at) {
    const expires = new Date(coupon.expires_at).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now()) {
      throw httpError(400, "This coupon has expired.");
    }
  }
  const minOrder = Number(coupon.min_order_amount) || 0;
  if (minOrder > 0 && subtotal < minOrder) {
    throw httpError(400, `Minimum order amount for this coupon is ${formatMoney(minOrder)}.`);
  }
  return couponDiscountFor(coupon, subtotal);
}

let couponsTableReady = null;
function ensureCouponsTable() {
  if (!couponsTableReady) {
    couponsTableReady = (async () => {
      await db.query(
        `CREATE TABLE IF NOT EXISTS coupons (
           id SERIAL PRIMARY KEY,
           code TEXT UNIQUE NOT NULL,
           discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed', 'percentage')),
           discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
           min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
           expires_at TIMESTAMPTZ,
           active BOOLEAN NOT NULL DEFAULT TRUE,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`
      );
      await db.query(
        "ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0"
      );
    })().catch((err) => {
      couponsTableReady = null;
      throw err;
    });
  }
  return couponsTableReady;
}

router.get("/", authenticate, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json({ orders: rows });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Failed to fetch orders." });
  }
});

router.get("/coupons", authenticate, async (req, res) => {
  try {
    await ensureCouponsTable();
    const { rows } = await db.query("SELECT * FROM coupons ORDER BY created_at DESC");
    res.json({ coupons: rows });
  } catch (err) {
    console.error("Error fetching coupons:", err);
    res.status(500).json({ message: "Failed to fetch coupons." });
  }
});

router.post("/coupons/validate", async (req, res) => {
  try {
    await ensureCouponsTable();
    const body = req.body || {};
    const code = normalizeCouponCode(body.code);
    if (!code) throw httpError(400, "Please enter a coupon code.");

    const subtotal = Number(body.subtotal);
    if (!Number.isFinite(subtotal) || subtotal < 0) {
      throw httpError(400, "Invalid order subtotal.");
    }

    const { rows } = await db.query("SELECT * FROM coupons WHERE code = $1", [code]);
    if (rows.length === 0) throw httpError(400, "Coupon code is invalid.");

    const coupon = rows[0];
    const discount = validateCouponForSubtotal(coupon, subtotal);
    res.json({
      coupon: {
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: Number(coupon.discount_value),
        min_order_amount: Number(coupon.min_order_amount),
        expires_at: coupon.expires_at,
      },
      discount,
    });
  } catch (err) {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Failed to validate coupon.";
    if (statusCode >= 500) console.error("Error validating coupon:", err);
    res.status(statusCode).json({ message });
  }
});

router.post("/coupons", authenticate, async (req, res) => {
  try {
    await ensureCouponsTable();
    const body = req.body || {};
    const code = normalizeCouponCode(body.code);
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
      throw httpError(400, "Coupon code must be 2-40 characters using letters, numbers, hyphens or underscores.");
    }

    const discountType = String(body.discount_type || "").toLowerCase();
    if (discountType !== "fixed" && discountType !== "percentage") {
      throw httpError(400, "Discount type must be fixed or percentage.");
    }

    const discountValue = Number(body.discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw httpError(400, "Discount value must be greater than zero.");
    }
    if (discountType === "percentage" && discountValue > 100) {
      throw httpError(400, "Percentage discount cannot be greater than 100.");
    }

    const rawMinOrder = body.min_order_amount;
    const minOrder = rawMinOrder == null || rawMinOrder === "" ? 0 : Number(rawMinOrder);
    if (!Number.isFinite(minOrder) || minOrder < 0) {
      throw httpError(400, "Minimum order amount must be zero or greater.");
    }

    let expiresAt = null;
    if (body.expires_at) {
      const parsedExpiry = new Date(body.expires_at);
      if (Number.isNaN(parsedExpiry.getTime())) {
        throw httpError(400, "Expiry date is invalid.");
      }
      expiresAt = parsedExpiry.toISOString();
    }

    const active = body.active === undefined
      ? true
      : body.active === true || body.active === "true" || body.active === 1 || body.active === "1";

    const { rows } = await db.query(
      `INSERT INTO coupons
         (code, discount_type, discount_value, min_order_amount, expires_at, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [code, discountType, roundMoney(discountValue), roundMoney(minOrder), expiresAt, active]
    );
    res.status(201).json({ coupon: rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(400).json({ message: "A coupon with this code already exists." });
    }
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Failed to create coupon.";
    if (statusCode >= 500) console.error("Error creating coupon:", err);
    res.status(statusCode).json({ message });
  }
});

router.put("/coupons/:id/status", authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid coupon id." });
  }
  const active = req.body ? req.body.active : undefined;
  if (typeof active !== "boolean") {
    return res.status(400).json({ message: "Active must be true or false." });
  }

  try {
    await ensureCouponsTable();
    const { rows } = await db.query(
      "UPDATE coupons SET active = $1 WHERE id = $2 RETURNING *",
      [active, id]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Coupon not found." });
    res.json({ coupon: rows[0] });
  } catch (err) {
    console.error("Error updating coupon:", err);
    res.status(500).json({ message: "Failed to update coupon." });
  }
});

router.delete("/coupons/:id", authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid coupon id." });
  }

  try {
    await ensureCouponsTable();
    const { rows } = await db.query("DELETE FROM coupons WHERE id = $1 RETURNING id", [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Coupon not found." });
    res.json({ deleted: true, id });
  } catch (err) {
    console.error("Error deleting coupon:", err);
    res.status(500).json({ message: "Failed to delete coupon." });
  }
});

router.put("/:id/status", authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid order id." });
  }

  const status = String(req.body.status || "").toLowerCase();
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid order status." });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Order not found." });
    }
    const order = rows[0];
    const prevStatus = String(order.order_status || "pending").toLowerCase();

    if (prevStatus === status) {
      await client.query("ROLLBACK");
      return res.json({ order });
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const productIds = items
      .map((it) => Number(it && it.product_id))
      .filter((x) => Number.isInteger(x) && x > 0);

    const hasDeducted = prevStatus === "confirmed" || prevStatus === "shipped" || prevStatus === "delivered";

    // Stock deduction happens once when moving into confirmed workflow (from pending).
    if (status === "confirmed" && !hasDeducted) {
      if (productIds.length > 0) {
        const { rows: prods } = await client.query(
          "SELECT id, title, stock FROM products WHERE id = ANY($1::int[]) FOR UPDATE",
          [productIds]
        );
        const productById = new Map(prods.map((p) => [String(p.id), p]));
        for (const it of items) {
          const pid = Number(it && it.product_id);
          const product = productById.get(String(pid));
          if (!product) {
            throw httpError(400, `Product with id ${pid} was not found. Order cannot be confirmed.`);
          }
          if (Number(product.stock) < 1) {
            throw httpError(400, `"${product.title}" is out of stock. Order cannot be confirmed.`);
          }
        }
        for (const product of prods) {
          const dec = await client.query(
            "UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1",
            [product.id]
          );
          if (dec.rowCount === 0) {
            throw httpError(400, `"${product.title}" is out of stock. Order cannot be confirmed.`);
          }
        }
      }
    }

    // Cancelled orders are permanently deleted. Restock first if stock was already deducted.
    if (status === "cancelled") {
      if (hasDeducted && productIds.length > 0) {
        await client.query(
          "UPDATE products SET stock = 1 WHERE id = ANY($1::int[])",
          [productIds]
        );
      }
      await client.query("DELETE FROM orders WHERE id = $1", [id]);
      await client.query("COMMIT");
      sendCancelNotification(order);
      return res.json({ deleted: true, id });
    }

    const paymentStatus = status === "confirmed" || status === "shipped" || status === "delivered" ? "confirmed" : "pending";

    const { rows: updated } = await client.query(
      `UPDATE orders
       SET order_status = $1, payment_status = $2
       WHERE id = $3
       RETURNING *`,
      [status, paymentStatus, id]
    );

    await client.query("COMMIT");
    res.json({ order: updated[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Failed to update order status.";
    if (statusCode >= 500) console.error("Error updating order status:", err);
    res.status(statusCode).json({ message });
  } finally {
    client.release();
  }
});

router.post("/", async (req, res) => {
  const couponCode = normalizeCouponCode(req.body && req.body.coupon_code);
  if (couponCode) {
    try {
      await ensureCouponsTable();
    } catch (err) {
      console.error("Error preparing coupon validation:", err);
      return res.status(500).json({ message: "Failed to prepare coupon validation." });
    }
  }

  const client = await db.pool.connect();
  try {
    const body = req.body || {};
    const first = stringField(body.first_name, 60);
    const last = stringField(body.last_name, 60);
    const email = stringField(body.email, 254);
    const phone = stringField(body.phone, 30);
    const address = stringField(body.address, 300);
    const city = stringField(body.city, 60);
    const postal = stringField(body.postal_code, 20);

    if (!first || !last) throw httpError(400, "Please provide your first and last name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "A valid email address is required.");
    if (phone.length < 7 || !/^[+\d][\d\s\-()]*$/.test(phone)) throw httpError(400, "A valid phone number is required.");
    if (!address) throw httpError(400, "Please provide your delivery address.");
    if (!city) throw httpError(400, "Please provide your city.");

    let parsedItems;
    try {
      parsedItems = typeof body.items === "string" ? JSON.parse(body.items) : body.items;
    } catch (err) {
      throw httpError(400, "Items must be valid JSON.");
    }
    if (!Array.isArray(parsedItems) || parsedItems.length === 0) throw httpError(400, "At least one item is required.");
    if (parsedItems.length > MAX_ITEMS) throw httpError(400, "Too many items in a single order.");

    const productIds = parsedItems.map((it) => Number(it && it.product_id));
    if (productIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw httpError(400, "Each item must reference a valid product id.");
    }

    const method = body.payment_method ? String(body.payment_method).toLowerCase() : "";
    const methodInfo = PAYMENT_METHODS[method];
    if (!methodInfo) throw httpError(400, "Selected payment method is not available.");

    const clientDelivery = Number(body.delivery_charges);
    const deliveryCharges = methodInfo.delivery_charges;
    if (!Number.isFinite(clientDelivery) || Math.round(clientDelivery * 100) !== Math.round(deliveryCharges * 100)) {
      throw httpError(400, "Invalid delivery charges for the selected payment method.");
    }

    await client.query("BEGIN");

    // Lock product rows to prevent race conditions / overselling.
    const { rows: products } = await client.query(
      `SELECT id, title, brand, price, sizes, stock FROM products WHERE id = ANY($1::int[]) FOR UPDATE`,
      [productIds]
    );
    const productMap = new Map(products.map((p) => [String(p.id), p]));

    let subtotal = 0;
    const safeItems = parsedItems.map((item, i) => {
      const product = productMap.get(String(productIds[i]));
      if (!product) throw httpError(400, `Product with id ${productIds[i]} was not found.`);

      const qty = Number(item.quantity);
      if (qty !== 1) throw httpError(400, "Each product allows a maximum quantity of 1.");

      const sizes = Array.isArray(product.sizes) ? product.sizes : [];
      const rawSize = item.size == null ? "" : String(item.size).trim();
      const size = rawSize
        ? rawSize.slice(0, 20)
        : (sizes.length > 0 ? String(sizes[0]) : "One Size");

      const unitPrice = Number(product.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw httpError(500, `Product "${product.title}" has an invalid price.`);
      }
      if (Number(product.stock) < 1) {
        throw httpError(400, `"${product.title}" is out of stock.`);
      }

      subtotal += unitPrice * qty;
      return {
        product_id: product.id,
        title: product.title,
        brand: product.brand,
        price: unitPrice,
        size,
        quantity: qty,
      };
    });

    subtotal = Math.round(subtotal * 100) / 100;

    let discount = 0;
    if (couponCode) {
      const { rows: couponRows } = await client.query(
        "SELECT * FROM coupons WHERE code = $1",
        [couponCode]
      );
      if (couponRows.length === 0) throw httpError(400, "Coupon code is invalid.");
      discount = validateCouponForSubtotal(couponRows[0], subtotal);
    }

    const expectedTotal = roundMoney(subtotal - discount + deliveryCharges);
    const clientTotal = Number(body.total_amount);
    if (!Number.isFinite(clientTotal) || Math.round(clientTotal * 100) !== Math.round(expectedTotal * 100)) {
      throw httpError(400, "Order total does not match the calculated amount.");
    }
    if (!(expectedTotal > 0) || expectedTotal > MAX_TOTAL) {
      throw httpError(400, "Order total is outside the allowed range.");
    }

    const customer_name = (first + " " + last).trim();
    const { rows } = await client.query(
      `INSERT INTO orders
         (customer_name, email, phone, address, city, postal_code, total_amount, delivery_charges,
          payment_method, payment_status, order_status, transaction_id, payment_proof, items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', NULL, NULL, $10)
       RETURNING *`,
      [
        customer_name,
        email,
        phone,
        address,
        city,
        postal || null,
        expectedTotal,
        deliveryCharges,
        method,
        JSON.stringify(safeItems),
      ]
    );
    const created = rows[0];

    await client.query("COMMIT");
    // Wait for the ntfy request so serverless deployments don't drop it, but never fail the order.
    try {
      await sendNtfy(created);
    } catch (notifyErr) {
      const msg = notifyErr && notifyErr.message ? notifyErr.message : String(notifyErr);
      console.error(`Order #${created.id} placed, but ntfy notification failed: ${msg}`);
    }
    res.status(201).json({ order: created });
  } catch (err) {
    await client.query("ROLLBACK");
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Failed to create order.";
    if (statusCode >= 500) console.error("Error creating order:", err);
    res.status(statusCode).json({ message });
  } finally {
    client.release();
  }
});

module.exports = router;