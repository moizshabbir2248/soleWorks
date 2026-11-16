require("dotenv").config();
const { pool } = require("../db");
(async () => {
  const c = await pool.connect();
  try {
    await c.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charges NUMERIC(10,2) NOT NULL DEFAULT 0");
    await c.query("UPDATE orders SET delivery_charges = 0 WHERE delivery_charges IS NULL");
    console.log("Orders delivery_charges column ensured.");
  } finally { c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });