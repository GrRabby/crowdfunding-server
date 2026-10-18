import { Router, Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "../db/schema";
import { authenticate } from "../middleware/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications
// Protected: any logged-in user — their own notifications, newest first
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.toUserId, req.user!.userId))
      .orderBy(desc(notifications.createdAt));

    const unreadCount = rows.filter((n) => !n.isRead).length;

    res.json({ ok: true, notifications: rows, unreadCount });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read
// Protected: mark a single notification as read (must be yours)
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id/read", authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: "Invalid ID" }); return; }

    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    if (!notification) { res.status(404).json({ ok: false, error: "Notification not found" }); return; }

    // Security: can only mark YOUR OWN notifications as read
    if (notification.toUserId !== req.user!.userId) {
      res.status(403).json({ ok: false, error: "Not your notification" });
      return;
    }

    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));

    res.json({ ok: true, message: "Notification marked as read" });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/read-all
// Protected: marks ALL of the user's unread notifications as read at once
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/read-all", authenticate, async (req: Request, res: Response) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.toUserId, req.user!.userId),
          eq(notifications.isRead, false)
        )
      );

    res.json({ ok: true, message: "All notifications marked as read" });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
