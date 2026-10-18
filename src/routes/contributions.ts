import { Router, Request, Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { contributions, campaigns, users, notifications, NewContribution } from "../db/schema";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// POST /api/contributions — supporter only
router.post("/", authenticate, requireRole("supporter"), async (req: Request, res: Response) => {
  try {
    const { campaignId, amount } = req.body;
    if (!campaignId || !amount) { res.status(400).json({ ok: false, error: "campaignId and amount are required" }); return; }

    const parsedAmount = parseInt(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) { res.status(400).json({ ok: false, error: "amount must be a positive number" }); return; }

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, parseInt(campaignId)));
    if (!campaign)                              { res.status(404).json({ ok: false, error: "Campaign not found" }); return; }
    if (campaign.status !== "approved")         { res.status(400).json({ ok: false, error: "You can only contribute to approved campaigns" }); return; }
    if (new Date(campaign.deadline) < new Date()) { res.status(400).json({ ok: false, error: "This campaign has passed its deadline" }); return; }
    if (parsedAmount < campaign.minContribution)  { res.status(400).json({ ok: false, error: `Minimum contribution is ${campaign.minContribution} credits` }); return; }

    const [supporter] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, req.user!.userId));
    if (supporter.credits < parsedAmount) {
      res.status(400).json({ ok: false, error: `Insufficient credits. You have ${supporter.credits}, need ${parsedAmount}` });
      return;
    }

    const [newContribution] = await db
      .insert(contributions)
      .values({ campaignId: parseInt(campaignId), supporterId: req.user!.userId, amount: parsedAmount } as NewContribution)
      .returning();

    await db.insert(notifications).values({
      toUserId: campaign.creatorId,
      message: `New contribution of ${parsedAmount} credits on "${campaign.title}" — awaiting your approval`,
      actionRoute: `/dashboard/contributions`,
    });

    res.status(201).json({ ok: true, message: "Contribution submitted — awaiting creator approval", contribution: newContribution });
  } catch (error: any) {
    console.error("POST /contributions:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET /api/contributions/incoming — creator only
router.get("/incoming", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id:             contributions.id,
        amount:         contributions.amount,
        status:         contributions.status,
        createdAt:      contributions.createdAt,
        campaignId:     contributions.campaignId,
        campaignTitle:  campaigns.title,
        supporterId:    contributions.supporterId,
        supporterName:  users.name,
        supporterEmail: users.email,
      })
      .from(contributions)
      .innerJoin(campaigns, eq(contributions.campaignId, campaigns.id))
      .innerJoin(users, eq(contributions.supporterId, users.id))
      .where(eq(campaigns.creatorId, req.user!.userId));

    res.json({ ok: true, contributions: rows });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET /api/contributions/mine — supporter only (with pagination)
router.get("/mine", authenticate, requireRole("supporter"), async (req: Request, res: Response) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit  = Math.min(20, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id:            contributions.id,
        amount:        contributions.amount,
        status:        contributions.status,
        createdAt:     contributions.createdAt,
        campaignId:    campaigns.id,
        campaignTitle: campaigns.title,
        campaignImage: campaigns.imageUrl,
      })
      .from(contributions)
      .innerJoin(campaigns, eq(contributions.campaignId, campaigns.id))
      .where(eq(contributions.supporterId, req.user!.userId))
      .limit(limit)
      .offset(offset);

    res.json({ ok: true, contributions: rows, page, limit });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// PATCH /api/contributions/:id/approve — creator only (TRANSACTION)
router.patch("/:id/approve", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [contribution] = await db.select().from(contributions).where(eq(contributions.id, id));
    if (!contribution)                      { res.status(404).json({ ok: false, error: "Contribution not found" }); return; }
    if (contribution.status !== "pending")  { res.status(400).json({ ok: false, error: `Contribution is already ${contribution.status}` }); return; }

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, contribution.campaignId));
    if (!campaign || campaign.creatorId !== req.user!.userId) {
      res.status(403).json({ ok: false, error: "You can only approve contributions to your own campaigns" });
      return;
    }

    const [supporter] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, contribution.supporterId));
    if (supporter.credits < contribution.amount) {
      res.status(400).json({ ok: false, error: `Supporter has insufficient credits (${supporter.credits} available, ${contribution.amount} needed)` });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(contributions).set({ status: "approved" }).where(eq(contributions.id, id));
      await tx.update(users).set({ credits: sql`${users.credits} - ${contribution.amount}` }).where(eq(users.id, contribution.supporterId));
      await tx.update(campaigns).set({ amountRaised: sql`${campaigns.amountRaised} + ${contribution.amount}`, updatedAt: new Date() }).where(eq(campaigns.id, contribution.campaignId));
      await tx.insert(notifications).values({ toUserId: contribution.supporterId, message: `Your ${contribution.amount}-credit contribution to "${campaign.title}" was approved!`, actionRoute: `/campaigns/${campaign.id}` });
    });

    res.json({ ok: true, message: "Contribution approved — credits transferred" });
  } catch (error: any) {
    console.error("PATCH /contributions/:id/approve:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// PATCH /api/contributions/:id/reject — creator only (TRANSACTION)
router.patch("/:id/reject", authenticate, requireRole("creator"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [contribution] = await db.select().from(contributions).where(eq(contributions.id, id));
    if (!contribution)                     { res.status(404).json({ ok: false, error: "Contribution not found" }); return; }
    if (contribution.status !== "pending") { res.status(400).json({ ok: false, error: `Contribution is already ${contribution.status}` }); return; }

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, contribution.campaignId));
    if (!campaign || campaign.creatorId !== req.user!.userId) {
      res.status(403).json({ ok: false, error: "You can only reject contributions to your own campaigns" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(contributions).set({ status: "rejected" }).where(eq(contributions.id, id));
      await tx.insert(notifications).values({ toUserId: contribution.supporterId, message: `Your ${contribution.amount}-credit contribution to "${campaign.title}" was not accepted.`, actionRoute: `/campaigns/${campaign.id}` });
    });

    res.json({ ok: true, message: "Contribution rejected" });
  } catch (error: any) {
    console.error("PATCH /contributions/:id/reject:", error);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
