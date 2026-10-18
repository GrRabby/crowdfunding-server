import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = "7d";

// Shape of data we embed inside the token
export interface JwtPayload {
  userId: number;
  email: string;
  role: "supporter" | "creator" | "admin";
}

// Sign → produces a token string
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Verify → decodes and validates the token, throws if invalid or expired
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
