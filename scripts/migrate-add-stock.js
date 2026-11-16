require("dotenv").config();
const { pool } = require("../db");

async function addStockColumn() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'stock'"
    );
    if (rows.length === 0) {
      await client.query("ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 1");
      console.log("Added products.stock (default 1).");
    } else {
      console.log("Column stock already exists. Nothing to do.");
    }
    await client.query("UPDATE products SET stock = 1");
    console.log("Set products.stock = 1 for all rows.");
  } finally {
    client.release();
    await pool.end();
  }
}

addStockColumn().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});