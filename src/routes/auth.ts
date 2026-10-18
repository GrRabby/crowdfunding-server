import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, NewUser } from "../db/schema";
import { signToken } from "../lib/jwt";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    // 1. Basic validation
    if (!name || !email || !password || !role) {
      res.status(400).json({ ok: false, error: "name, email, password, and role are required" });
      return;
    }

    // 2. Only allow self-registration for supporter and creator
    if (role !== "supporter" && role !== "creator") {
      res.status(400).json({ ok: false, error: "role must be 'supporter' or 'creator'" });
      return;
    }

    // 3. Check if email already exists
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      res.status(409).json({ ok: false, error: "Email already registered" });
      return;
    }

    // 4. Hash the password (10 salt rounds is the industry standard)
    const passwordHash = await bcrypt.hash(password, 10);

    // 5. Business Rule: starting credits depend on role
    const startingCredits = role === "supporter" ? 50 : 20;

    // 6. Insert user into database
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        role,
        credits: startingCredits,
      } as NewUser)
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        credits: users.credits,
        createdAt: users.createdAt,
      });

    // 7. Issue JWT token
    const token = signToken({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    res.status(201).json({
      ok: true,
      message: "Registration successful",
      token,
      user: newUser,
    });
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

    // 1. Basic validation
    if (!email || !password) {
      res.status(400).json({ ok: false, error: "email and password are required" });
      return;
    }

    // 2. Find user by email
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      res.status(401).json({ ok: false, error: "Invalid email or password" });
      return;
    }

    // 3. Block Google OAuth users from password login
    if (!user.passwordHash) {
      res.status(401).json({
        ok: false,
        error: "This account uses Google Sign-In. Please log in with Google.",
      });
      return;
    }

    // 4. Compare password against stored hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ ok: false, error: "Invalid email or password" });
      return;
    }

    // 5. Issue JWT token
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // 6. Return token and safe user data (never return passwordHash!)
    res.json({
      ok: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        credits: user.credits,
        photoUrl: user.photoUrl,
      },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ ok: false, error: "Server error during login" });
  }
});

export default router;
