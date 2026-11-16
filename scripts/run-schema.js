require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../db");
const bcrypt = require("bcryptjs");

async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log("Database schema created successfully.");

    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      const hash = bcrypt.hashSync(password, 10);
      const { rows } = await client.query(
        `INSERT INTO admin (email, password)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email`,
        [email, hash]
      );
      console.log(rows.length ? "Admin seeded: " + rows[0].email : "Admin already exists.");
    } else {
      console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set; skipped admin seed.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runSchema().catch((err) => {
  console.error("Failed to run schema:", err);
  process.exit(1);
});