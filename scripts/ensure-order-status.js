require("dotenv").config();
const { pool } = require("../db");
(async () => {
  const c = await pool.connect();
  try {
    await c.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_status TEXT");
    await c.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT");
    await c.query("ALTER TABLE orders ALTER COLUMN order_status SET DEFAULT 'pending'");
    await c.query("ALTER TABLE orders ALTER COLUMN payment_status SET DEFAULT 'pending'");
    await c.query("UPDATE orders SET order_status = 'pending' WHERE order_status IS NULL OR btrim(order_status) = ''");
    await c.query("UPDATE orders SET payment_status = 'pending' WHERE payment_status IS NULL OR btrim(payment_status) = ''");
    console.log("Orders status columns ensured.");
  } finally { c.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
