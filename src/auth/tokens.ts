import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-do-not-use-in-production";
export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(userId: number): string {
  return jwt.sign({}, JWT_SECRET, {
    subject: String(userId),
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): number {
  const payload = jwt.verify(token, JWT_SECRET);
  if (typeof payload === "string") {
    throw new Error("Invalid access token");
  }
  const sub = payload.sub;
  if (typeof sub !== "string") {
    throw new Error("Invalid access token");
  }
  const userId = Number(sub);
  if (!Number.isInteger(userId)) {
    throw new Error("Invalid access token");
  }
  return userId;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
