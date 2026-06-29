import { NextFunction, Request, Response } from "express";
import { AuthContext, Role, verifyToken } from "./jwt";
import { pool } from "../db/pool";
import { getAppointmentSalon, getStaffSalon } from "../repositories/authRepo";

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

/** Middleware: require the caller's role to be one of `roles`. */
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

/** Throw unless the path's salonId matches the caller's salon. */
export function assertSalon(req: Request, salonId: string): void {
  if (getAuth(req).salonId !== salonId) {
    throw new HttpError(403, "Cross-salon access denied");
  }
}

export async function assertStaffInSalon(req: Request, staffId: string): Promise<void> {
  const auth = getAuth(req);
  const salon = await getStaffSalon(pool, staffId);
  if (!salon) throw new HttpError(404, "Staff not found");
  if (salon !== auth.salonId) throw new HttpError(403, "Cross-salon access denied");
}

export async function assertAppointmentInSalon(
  req: Request,
  appointmentId: string
): Promise<void> {
  const auth = getAuth(req);
  const salon = await getAppointmentSalon(pool, appointmentId);
  if (!salon) throw new HttpError(404, "Appointment not found");
  if (salon !== auth.salonId) throw new HttpError(403, "Cross-salon access denied");
}
