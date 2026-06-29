import { NextFunction, Request, Response } from "express";
import { AuthContext, Role, verifyToken } from "./jwt";
import { pool } from "../db/pool";
import { getStaffRestaurant, getOrderRestaurant } from "../repositories/authRepo";

/** Error carrying an HTTP status; surfaced by the app's error handler. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}

/** Verify the Bearer token and attach req.auth. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) return next(new HttpError(401, "Missing bearer token"));
  try {
    (req as AuthedRequest).auth = verifyToken(match[1]);
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

export function getAuth(req: Request): AuthContext {
  const auth = (req as AuthedRequest).auth;
  if (!auth) throw new HttpError(401, "Not authenticated");
  return auth;
}

/** Require the caller's role to be one of `roles`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = getAuth(req);
      if (!roles.includes(auth.role)) {
        return next(new HttpError(403, "Insufficient role"));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Throw unless the path's restaurantId matches the caller's restaurant. */
export function assertRestaurant(req: Request, restaurantId: string): void {
  if (getAuth(req).restaurantId !== restaurantId) {
    throw new HttpError(403, "Cross-restaurant access denied");
  }
}

export async function assertStaffInRestaurant(req: Request, staffId: string): Promise<void> {
  const auth = getAuth(req);
  const rid = await getStaffRestaurant(pool, staffId);
  if (!rid) throw new HttpError(404, "Staff not found");
  if (rid !== auth.restaurantId) throw new HttpError(403, "Cross-restaurant access denied");
}

export async function assertOrderInRestaurant(req: Request, orderId: string): Promise<void> {
  const auth = getAuth(req);
  const rid = await getOrderRestaurant(pool, orderId);
  if (!rid) throw new HttpError(404, "Order not found");
  if (rid !== auth.restaurantId) throw new HttpError(403, "Cross-restaurant access denied");
}
