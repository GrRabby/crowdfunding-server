import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../lib/jwt";

// ─────────────────────────────────────────────────────────────────────────────
// Module Augmentation: Teach TypeScript that req.user exists on Express Request
// ─────────────────────────────────────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyToken Middleware
// Extracts "Bearer <token>" from Authorization header, verifies it,
// and attaches the decoded payload to req.user
// ─────────────────────────────────────────────────────────────────────────────
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ ok: false, error: "Not authenticated — no token provided" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// requireRole Middleware Factory
// Usage: requireRole("admin") or requireRole("creator", "admin")
// Must be placed AFTER authenticate in the middleware chain
// ─────────────────────────────────────────────────────────────────────────────
export function requireRole(...roles: JwtPayload["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        ok: false,
        error: `Access denied — required role: ${roles.join(" or ")}`,
      });
      return;
    }
    next();
  };
}
