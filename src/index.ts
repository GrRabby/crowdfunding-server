import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { sql } from "./db";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Root Health Check Route
app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "🚀 Crowdfunding API Server is active and running",
    timestamp: new Date().toISOString(),
  });
});

// Database Connectivity Test Route
app.get("/api/test-db", async (_req: Request, res: Response) => {
  try {
    // Run a lightweight raw query directly against Neon PostgreSQL
    const result = await sql`
      SELECT
        NOW() AS server_time,
        version() AS pg_version
    `;
    res.json({
      ok: true,
      message: "✅ PostgreSQL connection successful!",
      databaseResponse: result[0],
    });
  } catch (error: any) {
    console.error("❌ Database connection error:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to connect to PostgreSQL",
      details: error.message,
    });
  }
});

// Start Express Listener
app.listen(PORT, () => {
  console.log("\n=========================================");
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`📡 Health Check:   http://localhost:${PORT}/`);
  console.log(`🐘 DB Test Route:  http://localhost:${PORT}/api/test-db`);
  console.log("=========================================\n");
});
