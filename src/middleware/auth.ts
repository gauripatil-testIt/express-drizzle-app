import type { RequestHandler } from "express";
import { verifyAccessToken } from "../auth/tokens.js";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    req.userId = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
};
