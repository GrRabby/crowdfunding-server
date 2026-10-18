import { Router, Request, Response } from "express";
import { eq, and, desc, ilike, count, sql } from "drizzle-orm";
import { db } from "../db";
import { campaigns, users, contributions, NewCampaign } from "../db/schema";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/campaigns
// Public — returns only APPROVED campaigns
// Supports ?category=yoga&page=1&limit=10
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(20, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;
    const category = req.query.category as string | undefined;

    const conditions = [eq(campaigns.status, "approved")];
    if (category) conditions.push(ilike(campaigns.category, category));
    const where = and(...conditions);

    const rows = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        category: campaigns.category,
        fundingGoal: campaigns.fundingGoal,
        amountRaised: campaigns.amountRaised,
        deadline: campaigns.deadline,
        imageUrl: campaigns.imageUrl,
        createdAt: campaigns.createdAt,
        creatorId: campaigns.creatorId,
        creatorName: users.name,
        creatorPhoto: users.photoUrl,
      })
      .from(campaigns)
      .innerJoin(users, eq(campaigns.creatorId, users.id))
      .where(where)
      .orderBy(desc(campaigns.amountRaised))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(campaigns).where(where);

    res.json({
      ok: true,
      campaigns: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    console.error("GET /campaigns:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/campaigns/my
// Protected: creator only — all their campaigns regardless of status
// NOTE: must be defined BEFORE /:id so Express doesn't treat "my" as an id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/my", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.creatorId, req.user!.userId))
      .orderBy(desc(campaigns.createdAt));

    res.json({ ok: true, campaigns: rows });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/campaigns/:id
// Public — single campaign with creator info
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [row] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        story: campaigns.story,
        category: campaigns.category,
        fundingGoal: campaigns.fundingGoal,
        minContribution: campaigns.minContribution,
        amountRaised: campaigns.amountRaised,
        deadline: campaigns.deadline,
        rewardInfo: campaigns.rewardInfo,
        imageUrl: campaigns.imageUrl,
        status: campaigns.status,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        creatorId: campaigns.creatorId,
        creatorName: users.name,
        creatorPhoto: users.photoUrl,
      })
      .from(campaigns)
      .innerJoin(users, eq(campaigns.creatorId, users.id))
      .where(eq(campaigns.id, id));

    if (!row) { res.status(404).json({ ok: false, error: "Campaign not found" }); return; }

    res.json({ ok: true, campaign: row });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/campaigns
// Protected: creator only — status defaults to "pending" (needs admin approval)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const { title, story, category, fundingGoal, minContribution, deadline, rewardInfo, imageUrl } = req.body;

    if (!title || !story || !category || !fundingGoal || !deadline || !imageUrl) {
      res.status(400).json({ ok: false, error: "title, story, category, fundingGoal, deadline and imageUrl are required" });
      return;
    }

    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime()) || deadlineDate <= new Date()) {
      res.status(400).json({ ok: false, error: "deadline must be a valid future date" });
      return;
    }

    const [newCampaign] = await db
      .insert(campaigns)
      .values({
        creatorId: req.user!.userId,
        title,
        story,
        category,
        fundingGoal: parseInt(fundingGoal),
        minContribution: parseInt(minContribution) || 1,
        deadline: deadlineDate,
        rewardInfo: rewardInfo || null,
        imageUrl,
      } as NewCampaign)
      .returning();

    res.status(201).json({ ok: true, message: "Campaign submitted for review", campaign: newCampaign });
  } catch (error: any) {
    console.error("POST /campaigns:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/campaigns/:id
// Protected: creator only — can only edit their OWN pending campaigns
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!existing) { res.status(404).json({ ok: false, error: "Campaign not found" }); return; }
    if (existing.creatorId !== req.user!.userId) { res.status(403).json({ ok: false, error: "You can only edit your own campaigns" }); return; }
    if (existing.status !== "pending") { res.status(400).json({ ok: false, error: `Cannot edit a ${existing.status} campaign` }); return; }

    const { title, story, category, fundingGoal, minContribution, deadline, rewardInfo, imageUrl } = req.body;

    const [updated] = await db
      .update(campaigns)
      .set({
        ...(title && { title }),
        ...(story && { story }),
        ...(category && { category }),
        ...(fundingGoal && { fundingGoal: parseInt(fundingGoal) }),
        ...(minContribution && { minContribution: parseInt(minContribution) }),
        ...(deadline && { deadline: new Date(deadline) }),
        ...(rewardInfo !== undefined && { rewardInfo }),
        ...(imageUrl && { imageUrl }),
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id))
      .returning();

    res.json({ ok: true, message: "Campaign updated", campaign: updated });
  } catch (error: any) {
    console.error("PATCH /campaigns/:id:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/campaigns/:id
// Protected: creator only
// Business rule: refund ALL approved contributors before deleting
// Uses a DB transaction so refunds and delete are atomic
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!existing) { res.status(404).json({ ok: false, error: "Campaign not found" }); return; }
    if (existing.creatorId !== req.user!.userId) { res.status(403).json({ ok: false, error: "You can only delete your own campaigns" }); return; }

    // Fetch all approved contributions that need refunds
    const approvedContributions = await db
      .select()
      .from(contributions)
      .where(and(eq(contributions.campaignId, id), eq(contributions.status, "approved")));

    // TRANSACTION: refund each supporter, then delete campaign (cascades to contributions)
    await db.transaction(async (tx) => {
      for (const c of approvedContributions) {
        // credits = credits + refund_amount  (atomic SQL increment)
        await tx
          .update(users)
          .set({ credits: sql`${users.credits} + ${c.amount}` })
          .where(eq(users.id, c.supporterId));
      }
      await tx.delete(campaigns).where(eq(campaigns.id, id));
    });

    res.json({ ok: true, message: "Campaign deleted", refundedCount: approvedContributions.length });
  } catch (error: any) {
    console.error("DELETE /campaigns/:id:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/campaigns/:id/status
// Protected: admin only — approve or reject a pending campaign
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id/status", authenticate, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ ok: false, error: "status must be 'approved' or 'rejected'" });
      return;
    }

    const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!existing) { res.status(404).json({ ok: false, error: "Campaign not found" }); return; }
    if (existing.status !== "pending") { res.status(400).json({ ok: false, error: `Campaign is already ${existing.status}` }); return; }

    const [updated] = await db
      .update(campaigns)
      .set({ status, updatedAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();

    res.json({ ok: true, message: `Campaign ${status}`, campaign: updated });
  } catch (error: any) {
    console.error("PATCH /campaigns/:id/status:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
