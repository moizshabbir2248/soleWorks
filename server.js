require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
const { INVALID_IMAGE_MESSAGE } = require("./middleware/upload");
const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/admin", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);

app.get("/health", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT NOW() AS now");
    res.json({ status: "ok", dbTime: rows[0].now });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image is too large. Maximum size is 1.5 MB."
        : "Image upload failed.";
    return res.status(400).json({ message: msg });
  }
  if (err && (err.message === INVALID_IMAGE_MESSAGE || err.message === "Only image files are allowed.")) {
    return res.status(400).json({ message: err.message });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error." });
});

// Keep the process alive and loud about errors instead of silently exiting.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\nPort ${PORT} is already in use. ` +
          "Another instance of the server is probably still running.\n" +
          "Stop it first (e.g. close the old terminal, or run:\n" +
          `  Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n`)
        ;
      process.exit(1);
    }
    console.error("Server error:", err);
    process.exit(1);
  });

  // Graceful shutdown on Ctrl+C / kill.
  const shutdown = () => {
    console.log("\nShutting down gracefully...");
    server.close(() => {
      db.pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = app;