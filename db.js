require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("connect", () => {
  console.log("Connected to Neon DB");
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Neon DB client:", err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};