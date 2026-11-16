require("dotenv").config();
const { pool } = require("../db");
const bcrypt = require("bcryptjs");

(async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env");
  }

  const hash = bcrypt.hashSync(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO admin (email, password)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`,
    [email, hash]
  );
  console.log(rows.length ? "Admin seeded: " + rows[0].email : "Admin already exists.");
  await pool.end();
})();