-- =============================================
-- E-commerce Footwear Store Schema (Neon DB / Postgres)
-- Run with: npm run db:setup
-- =============================================

-- products: footwear items
CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  title         TEXT    NOT NULL,
  brand         TEXT    NOT NULL,
  price         NUMERIC(10, 2) NOT NULL,
  images        JSONB   NOT NULL DEFAULT '[]',
  sizes         JSONB   NOT NULL DEFAULT '[]',
  stock         INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- orders: customer orders (items stored as JSONB)
CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  customer_name    TEXT        NOT NULL,
  email            TEXT,
  phone            TEXT        NOT NULL,
  address          TEXT        NOT NULL,
  city             TEXT        NOT NULL,
  postal_code      TEXT,
  total_amount     NUMERIC(10, 2) NOT NULL,
  delivery_charges NUMERIC(10, 2) NOT NULL DEFAULT 0,
  payment_method   TEXT        NOT NULL DEFAULT 'cod_advance',
  payment_status   TEXT        NOT NULL DEFAULT 'pending',
  order_status     TEXT        NOT NULL DEFAULT 'pending',
  transaction_id   TEXT,
  payment_proof    TEXT,
  items            JSONB       NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- admin: login credentials (email + bcrypt-hashed password)
CREATE TABLE IF NOT EXISTS admin (
  id       SERIAL PRIMARY KEY,
  email    TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin user is seeded by scripts/seed-admin.js (reads ADMIN_EMAIL/ADMIN_PASSWORD from .env).
-- Do not hardcode credentials in this schema file.