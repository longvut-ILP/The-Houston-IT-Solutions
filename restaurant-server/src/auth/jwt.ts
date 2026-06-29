import jwt, { SignOptions } from "jsonwebtoken";

export type Role = "OWNER" | "ADMIN" | "STAFF";

export interface AuthContext {
  staffId: string;
  restaurantId: string;
  role: Role;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export function signToken(ctx: AuthContext): string {
  const opts: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN as SignOptions["expiresIn"]) ?? "12h",
  };
  return jwt.sign(ctx, secret(), opts);
}

export function verifyToken(token: string): AuthContext {
  const decoded = jwt.verify(token, secret()) as jwt.JwtPayload & AuthContext;
  return {
    staffId: decoded.staffId,
    restaurantId: decoded.restaurantId,
    role: decoded.role,
  };
}
