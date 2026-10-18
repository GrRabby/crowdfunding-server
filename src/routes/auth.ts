import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, NewUser } from "../db/schema";
import { signToken } from "../lib/jwt";
import { authenticate } from "../middleware/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      res.status(400).json({ ok: false, error: "name, email, password, and role are required" });
      return;
    }

    if (role !== "supporter" && role !== "creator") {
      res.status(400).json({ ok: false, error: "role must be 'supporter' or 'creator'" });
      return;
    }

    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      res.status(409).json({ ok: false, error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const startingCredits = role === "supporter" ? 50 : 20;

    const [newUser] = await db
      .insert(users)
      .values({ name, email, passwordHash, role, credits: startingCredits } as NewUser)
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        credits: users.credits,
        createdAt: users.createdAt,
      });

    const token = signToken({ userId: newUser.id, email: newUser.email, role: newUser.role });

    res.status(201).json({ ok: true, message: "Registration successful", token, user: newUser });
  } catch (error: any) {
    console.error("Register error:", error);
    res.status(500).json({ ok: false, error: "Server error during registration" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ ok: false, error: "email and password are required" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      res.status(401).json({ ok: false, error: "Invalid email or password" });
      return;
    }

    if (!user.passwordHash) {
      res.status(401).json({
        ok: false,
        error: "This account uses Google Sign-In. Please log in with Google.",
      });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ ok: false, error: "Invalid email or password" });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.json({
      ok: true,
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, credits: user.credits, photoUrl: user.photoUrl },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ ok: false, error: "Server error during login" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me  ← PROTECTED: requires valid Bearer token
// This is the route the frontend calls on app load to restore the session
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        credits: users.credits,
        photoUrl: users.photoUrl,
      })
      .from(users)
      .where(eq(users.id, req.user!.userId));

    if (!user) {
      res.status(404).json({ ok: false, error: "User not found" });
      return;
    }

    res.json({ ok: true, user });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
