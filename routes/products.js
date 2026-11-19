const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/auth");
const upload = require("../middleware/upload");
const { inspectUploadedImage, fileToDataUrl, MAX_IMAGE_FILES } = require("../middleware/upload");

const router = express.Router();

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function parseSizes(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

let ensureProductColumnsPromise = null;

function ensureProductColumns() {
  if (!ensureProductColumnsPromise) {
    ensureProductColumnsPromise = db.query(
      `ALTER TABLE products
         ADD COLUMN IF NOT EXISTS size_eu TEXT,
         ADD COLUMN IF NOT EXISTS size_us_uk TEXT,
         ADD COLUMN IF NOT EXISTS insole_cm TEXT`
    ).catch((err) => {
      ensureProductColumnsPromise = null;
      throw err;
    });
  }
  return ensureProductColumnsPromise;
}

function optionalText(value, maxLen = 30) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLen) : null;
}

router.get("/", async (req, res) => {
  try {
    await ensureProductColumns();
    const { rows } = await db.query(
      "SELECT * FROM products ORDER BY created_at DESC"
    );
    let pendingIds = new Set();
    try {
      const pending = await db.query(
        `SELECT DISTINCT (elem->>'product_id')::int AS pid
         FROM orders, jsonb_array_elements(items) AS elem
         WHERE order_status = 'pending'`
      );
      pendingIds = new Set(
        pending.rows.map((r) => Number(r.pid)).filter((n) => Number.isInteger(n) && n > 0)
      );
    } catch (e) {
      pendingIds = new Set();
    }
    const products = rows.map((p) => ({
      ...p,
      has_pending_order: Number(p.stock) > 0 && pendingIds.has(Number(p.id)),
    }));
    res.json({ products });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ message: "Failed to fetch products." });
  }
});

router.post("/", authenticate, upload.array("images", MAX_IMAGE_FILES), inspectUploadedImage, async (req, res) => {
  try {
    await ensureProductColumns();
    const title = String(req.body.title || "").trim();
    const brand = String(req.body.brand || "").trim();

    if (!title || !brand) {
      throw httpError(400, "title and brand are required.");
    }

    const grossPrice = req.body.price;
    if (grossPrice === undefined || grossPrice === null || grossPrice === "") {
      throw httpError(400, "price is required.");
    }

    const numericPrice = Number(grossPrice);
    if (isNaN(numericPrice) || numericPrice < 0) {
      throw httpError(400, "price must be a positive number.");
    }

    const sizes = parseSizes(req.body.sizes);
    const sizeEu = optionalText(req.body.size_eu);
    const sizeUsUk = optionalText(req.body.size_us_uk);
    const insoleCm = optionalText(req.body.insole_cm);
    const images = Array.isArray(req.files)
      ? req.files.map(fileToDataUrl).filter(Boolean)
      : [];
    const stockVal = req.body.stock;
    const stock = stockVal === undefined || stockVal === null || stockVal === ""
      ? 1
      : (String(stockVal).toLowerCase() === "out" || String(stockVal) === "0" || String(stockVal).toLowerCase() === "false" ? 0 : 1);

    const { rows } = await db.query(
      `INSERT INTO products (title, brand, price, images, sizes, stock, size_eu, size_us_uk, insole_cm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [title, brand, numericPrice, JSON.stringify(images), JSON.stringify(sizes), stock, sizeEu, sizeUsUk, insoleCm]
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Failed to create product.";
    if (statusCode >= 500) console.error("Error creating product:", err);
    res.status(statusCode).json({ message });
  }
});

router.put("/:id", authenticate, upload.array("images", MAX_IMAGE_FILES), inspectUploadedImage, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid product id." });
  }

  try {
    await ensureProductColumns();
    const title = String(req.body.title || "").trim();
    const brand = String(req.body.brand || "").trim();

    if (!title || !brand) {
      throw httpError(400, "title and brand are required.");
    }

    const grossPrice = req.body.price;
    if (grossPrice === undefined || grossPrice === null || grossPrice === "") {
      throw httpError(400, "price is required.");
    }

    const numericPrice = Number(grossPrice);
    if (isNaN(numericPrice) || numericPrice < 0) {
      throw httpError(400, "price must be a positive number.");
    }

    const sizes = parseSizes(req.body.sizes);

    const { rows: existing } = await db.query(
      "SELECT images, stock, size_eu, size_us_uk, insole_cm FROM products WHERE id = $1",
      [id]
    );
    if (existing.length === 0) {
      throw httpError(404, "Product not found.");
    }

    let images = Array.isArray(existing[0].images) ? existing[0].images.slice() : [];
    if (Array.isArray(req.files) && req.files.length > 0) {
      images = req.files.map(fileToDataUrl).filter(Boolean);
    }

    const stockVal = req.body.stock;
    const stock = stockVal === undefined || stockVal === null || stockVal === ""
      ? Number(existing[0].stock) || 0
      : (String(stockVal).toLowerCase() === "out" || String(stockVal) === "0" || String(stockVal).toLowerCase() === "false" ? 0 : 1);

    const sizeEu = req.body.size_eu === undefined
      ? optionalText(existing[0].size_eu)
      : optionalText(req.body.size_eu);
    const sizeUsUk = req.body.size_us_uk === undefined
      ? optionalText(existing[0].size_us_uk)
      : optionalText(req.body.size_us_uk);
    const insoleCm = req.body.insole_cm === undefined
      ? optionalText(existing[0].insole_cm)
      : optionalText(req.body.insole_cm);

    const { rows } = await db.query(
      `UPDATE products
       SET title = $1, brand = $2, price = $3, images = $4, sizes = $5, stock = $6,
           size_eu = $7, size_us_uk = $8, insole_cm = $9
       WHERE id = $10
       RETURNING *`,
      [title, brand, numericPrice, JSON.stringify(images), JSON.stringify(sizes), stock, sizeEu, sizeUsUk, insoleCm, id]
    );
    res.json({ product: rows[0] });
  } catch (err) {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Failed to update product.";
    if (statusCode >= 500) console.error("Error updating product:", err);
    res.status(statusCode).json({ message });
  }
});

router.delete("/:id", authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid product id." });
  }

  try {
    const { rows } = await db.query("SELECT id FROM products WHERE id = $1", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Product not found." });
    }

    await db.query("DELETE FROM products WHERE id = $1", [id]);

    res.json({ message: "Product deleted." });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ message: "Failed to delete product." });
  }
});

module.exports = router;