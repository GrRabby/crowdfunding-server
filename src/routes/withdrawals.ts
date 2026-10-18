import { Router, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { withdrawals, users, notifications, NewWithdrawal } from "../db/schema";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/withdrawals
// Protected: creator only
// Creator withdraws from their OWN credits balance.
// Fields: amount, paymentSystem, accountNumber
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const { amount, paymentSystem, accountNumber } = req.body;

    if (!amount || !paymentSystem || !accountNumber) {
      res.status(400).json({ ok: false, error: "amount, paymentSystem, and accountNumber are required" });
      return;
    }

    const parsedAmount = parseInt(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ ok: false, error: "amount must be a positive number" });
      return;
    }

    // Check creator has enough credits
    const [creator] = await db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, req.user!.userId));

    if (creator.credits < parsedAmount) {
      res.status(400).json({
        ok: false,
        error: `Insufficient credits. You have ${creator.credits}, need ${parsedAmount}`,
      });
      return;
    }

    const [newWithdrawal] = await db
      .insert(withdrawals)
      .values({
        creatorId:     req.user!.userId,
        credits:       creator.credits,       // snapshot of balance at request time
        amount:        parsedAmount,
        paymentSystem,
        accountNumber,
        // status defaults to "pending"
      } as NewWithdrawal)
      .returning();

    res.status(201).json({
      ok: true,
      message: "Withdrawal request submitted — awaiting admin approval",
      withdrawal: newWithdrawal,
    });
  } catch (error: any) {
    console.error("POST /withdrawals:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/withdrawals/mine
// Protected: creator only
// ─────────────────────────────────────────────────────────────────────────────
router.get("/mine", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.creatorId, req.user!.userId));

    res.json({ ok: true, withdrawals: rows });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/withdrawals/pending
// Protected: admin only — view all pending requests
// ─────────────────────────────────────────────────────────────────────────────
router.get("/pending", authenticate, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id:            withdrawals.id,
        amount:        withdrawals.amount,
        credits:       withdrawals.credits,
        paymentSystem: withdrawals.paymentSystem,
        accountNumber: withdrawals.accountNumber,
        status:        withdrawals.status,
        createdAt:     withdrawals.createdAt,
        creatorId:     withdrawals.creatorId,
        creatorName:   users.name,
        creatorEmail:  users.email,
      })
      .from(withdrawals)
      .innerJoin(users, eq(withdrawals.creatorId, users.id))
      .where(eq(withdrawals.status, "pending"));

    res.json({ ok: true, withdrawals: rows });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/withdrawals/:id/approve
// Protected: admin only
// TRANSACTION: mark approved + deduct creator credits atomically
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id/approve", authenticate, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, id));
    if (!withdrawal)                     { res.status(404).json({ ok: false, error: "Withdrawal not found" }); return; }
    if (withdrawal.status !== "pending") { res.status(400).json({ ok: false, error: `Withdrawal is already ${withdrawal.status}` }); return; }

    // Re-check creator still has enough credits
    const [creator] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, withdrawal.creatorId));
    if (creator.credits < withdrawal.amount) {
      res.status(400).json({
        ok: false,
        error: `Creator now has only ${creator.credits} credits — cannot approve withdrawal of ${withdrawal.amount}`,
      });
      return;
    }

    await db.transaction(async (tx) => {
      // 1. Mark approved
      await tx.update(withdrawals).set({ status: "approved" }).where(eq(withdrawals.id, id));

      // 2. Deduct credits from creator (atomic SQL decrement)
      await tx
        .update(users)
        .set({ credits: sql`${users.credits} - ${withdrawal.amount}` })
        .where(eq(users.id, withdrawal.creatorId));

      // 3. Notify the creator
      await tx.insert(notifications).values({
        toUserId: withdrawal.creatorId,
        message: `Your withdrawal of ${withdrawal.amount} credits via ${withdrawal.paymentSystem} was approved!`,
        actionRoute: `/dashboard/withdrawals`,
      });
    });

    res.json({ ok: true, message: "Withdrawal approved — credits deducted from creator" });
  } catch (error: any) {
    console.error("PATCH /withdrawals/:id/approve:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/withdrawals/:id/reject
// Protected: admin only — no credits move
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id/reject", authenticate, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, id));
    if (!withdrawal)                     { res.status(404).json({ ok: false, error: "Withdrawal not found" }); return; }
    if (withdrawal.status !== "pending") { res.status(400).json({ ok: false, error: `Withdrawal is already ${withdrawal.status}` }); return; }

    await db.transaction(async (tx) => {
      await tx.update(withdrawals).set({ status: "rejected" }).where(eq(withdrawals.id, id));

      await tx.insert(notifications).values({
        toUserId: withdrawal.creatorId,
        message: `Your withdrawal request of ${withdrawal.amount} credits was rejected.`,
        actionRoute: `/dashboard/withdrawals`,
      });
    });

    res.json({ ok: true, message: "Withdrawal rejected" });
  } catch (error: any) {
    console.error("PATCH /withdrawals/:id/reject:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
