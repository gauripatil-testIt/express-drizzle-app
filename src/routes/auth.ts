import { Router, type RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  checkRateLimit,
  clearFailedLogins,
  recordFailedLogin,
} from "../auth/rateLimit.js";
import {
  generateRefreshToken,
  hashToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from "../auth/tokens.js";
import { db } from "../db/index.js";
import { publicUserColumns, refreshTokens, users } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";

const MIN_PASSWORD_LENGTH = 10;
const INVALID_CREDENTIALS = "Invalid credentials";

export const register: RequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
  };
  const { name, email, password } = body;

  if (typeof name !== "string" || !name || typeof email !== "string" || !email) {
    return res.status(400).json({ error: "name and email are required" });
  }

  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be at least 10 characters" });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .returning(publicUserColumns);

  res.status(201).json(user);
};

export const login: RequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  if (checkRateLimit(ip, email)) {
    return res.status(429).json({ error: "Too many failed login attempts" });
  }

  if (!email || !password) {
    recordFailedLogin(ip, email);
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || user.passwordHash === null) {
    recordFailedLogin(ip, email);
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    recordFailedLogin(ip, email);
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  clearFailedLogins(ip, email);

  const accessToken = signAccessToken(user.id);
  const refreshToken = generateRefreshToken();
  await db.insert(refreshTokens).values({
    tokenHash: hashToken(refreshToken),
    userId: user.id,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  res.status(200).json({ accessToken, refreshToken });
};

export const refresh: RequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as { refreshToken?: unknown };
  const rawToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  if (!rawToken) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const tokenHash = hashToken(rawToken);
  const [tokenRow] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));

  if (!tokenRow) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const now = Date.now();

  if (tokenRow.revokedAt !== null) {
    // Reuse of a revoked token is treated as theft: revoke every active token for the user.
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, tokenRow.userId), isNull(refreshTokens.revokedAt)));
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  if (tokenRow.expiresAt <= now) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  // Rotate: revoke the presented token and issue a fresh pair.
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(eq(refreshTokens.id, tokenRow.id));

  const accessToken = signAccessToken(tokenRow.userId);
  const refreshToken = generateRefreshToken();
  await db.insert(refreshTokens).values({
    tokenHash: hashToken(refreshToken),
    userId: tokenRow.userId,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
  });

  res.status(200).json({ accessToken, refreshToken });
};

export const logout: RequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as { refreshToken?: unknown };
  const rawToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  if (!rawToken) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const tokenHash = hashToken(rawToken);
  const [tokenRow] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));

  if (tokenRow) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: Date.now() })
      .where(eq(refreshTokens.id, tokenRow.id));
  }

  res.status(204).end();
};

export const setPassword: RequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as { password?: unknown };
  const password = body.password;
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be at least 10 characters" });
  }

  const userId = req.userId;
  if (userId === undefined) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);

  if (!user) return res.status(404).json({ error: "Not found" });
  res.status(200).json(user);
};

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.post("/set-password", requireAuth, setPassword);
