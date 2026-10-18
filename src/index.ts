import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { db } from "./db";

// ── Routes ──────────────────────────────────────────────────────────────────
import authRouter from "./routes/auth";
import campaignsRouter from "./routes/campaigns";
import contributionsRouter from "./routes/contributions";
import withdrawalsRouter from "./routes/withdrawals";
import notificationsRouter from "./routes/notifications";
const app = express();
const PORT = process.env.PORT || 5000;

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "🚀 Crowdfunding API Server is running",
    timestamp: new Date().toISOString(),
  });
});

// ── DB Test (can remove before production) ───────────────────────────────────
app.get("/api/test-db", async (_req: Request, res: Response) => {
  try {
    const rawResult = await db.execute("SELECT NOW() as server_time");
    res.json({
      ok: true,
      message: "✅ PostgreSQL connection verified!",
      serverTime: rawResult.rows[0].server_time,
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/contributions", contributionsRouter);
app.use("/api/withdrawals", withdrawalsRouter);
app.use("/api/notifications", notificationsRouter);
// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`🚀 Server  →  http://localhost:${PORT}`);
  console.log(`📡 Health  →  GET /`);
  console.log(`🔐 Auth    →  POST /api/auth/register`);
  console.log(`🔐 Auth    →  POST /api/auth/login`);
  console.log(`=========================================\n`);
});



