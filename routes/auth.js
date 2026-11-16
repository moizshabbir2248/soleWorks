const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();

function setAuthCookie(res, token) {
  // Session cookie for admin panel convenience (7 days)
  res.cookie("admin_token", token, {
    httpOnly: false,
    sameSite: "Lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function getAdminPassword() {
  const value = process.env.ADMIN_PIN;
  return typeof value === "string" ? value.trim() : "";
}

function issueAdminToken(res) {
  if (!process.env.JWT_SECRET) {
    const err = new Error("Server auth is not configured.");
    err.statusCode = 500;
    throw err;
  }
  const token = jwt.sign(
    { id: 0, email: "admin@access", role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  setAuthCookie(res, token);
  return token;
}

router.post("/pin-login", async (req, res) => {
  const provided = String((req.body && (req.body.pin || req.body.password)) || "").trim();
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    return res.status(500).json({ message: "Admin password is not configured." });
  }
  if (provided !== adminPassword) {
    return res.status(401).json({ message: "Invalid password." });
  }

  try {
    const token = issueAdminToken(res);
    return res.json({
      message: "Login successful.",
      token,
      admin: { id: 0, email: "admin@access" },
    });
  } catch (err) {
    console.error("Admin password login error:", err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error." });
  }
});

router.post("/login", async (req, res) => {
  const body = req.body || {};
  const providedShortcut = String(body.pin || (body.password && !body.email ? body.password : "") || "").trim();
  const adminPassword = getAdminPassword();

  // Convenience: allow admin password shortcut via the same endpoint
  if (providedShortcut && !body.email) {
    if (!adminPassword) {
      return res.status(500).json({ message: "Admin password is not configured." });
    }
    if (providedShortcut !== adminPassword) {
      return res.status(401).json({ message: "Invalid password." });
    }
    try {
      const token = issueAdminToken(res);
      return res.json({ message: "Login successful.", token, admin: { id: 0, email: "admin@access" } });
    } catch (err) {
      console.error("Admin password login error:", err);
      return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error." });
    }
  }

  const { email, password } = body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const { rows } = await db.query("SELECT * FROM admin WHERE email = $1", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    setAuthCookie(res, token);

    return res.json({
      message: "Login successful.",
      token,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
});

module.exports = router;