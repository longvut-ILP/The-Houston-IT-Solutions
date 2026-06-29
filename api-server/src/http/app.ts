import express, { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { getCurrentConfig } from "../repositories/settingsRepo";
import { getStaffWithProfile, listStaffWithProfiles } from "../repositories/staffRepo";
import { getTicketsForDay } from "../repositories/reportsRepo";
import { checkout } from "../services/checkoutService";
import {
  computeWorkweek,
  computeWorkweekForSalon,
  generateAndPersistWorkweek,
} from "../services/payrollService";
import { computeDailyPool, persistDailyPool } from "../services/tipPoolService";
import { createStaff, setStaffPassword, updateSettings, updateStaffComp } from "../services/adminService";
import {
  createAppointment,
  listForDay,
  setStatus,
} from "../services/appointmentService";
import { login, logout, me, refresh, registerSalon } from "../services/authService";
import { clockIn, clockOut, getStatus } from "../services/timeClockService";
import { stripeWebhookHandler } from "./webhooks/stripeWebhook";
import { todayInTz, workweekStartInTz } from "../lib/time";
import {
  assertAppointmentInSalon,
  assertSalon,
  assertStaffInSalon,
  getAuth,
  HttpError,
  requireAuth,
  requireRole,
} from "../auth/middleware";

// Wrap async handlers so thrown/rejected errors reach the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const checkoutSchema = z.object({
  techId: z.string().uuid(),
  appointmentId: z.string().uuid().nullish(),
  actorStaffId: z.string().uuid().nullish(),
  lineItems: z
    .array(
      z.object({
        kind: z.enum(["SERVICE", "RETAIL"]),
        description: z.string().optional(),
        quantity: z.number().int().positive().optional(),
        amountCents: z.number().int().nonnegative(),
      })
    )
    .min(1),
  tips: z
    .array(
      z.object({
        method: z.enum(["CARD", "CASH"]),
        amountCents: z.number().int().nonnegative(),
      })
    )
    .optional(),
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const settingsSchema = z.object({
  ccFeePctBps: z.number().int().min(0).max(10000),
  ccFeeFixedCents: z.number().int().min(0),
  productCostPctBps: z.number().int().min(0).max(10000),
  minWageCentsPerHour: z.number().int().min(0),
  tipPoolingEnabled: z.boolean(),
  timezone: z.string().min(1).optional(),
});

const compShape = {
  employmentType: z.enum(["W2", "1099"]),
  serviceCommissionBps: z.number().int().min(0).max(10000).nullish(),
  retailCommissionBps: z.number().int().min(0).max(10000).nullish(),
  rentAmountCents: z.number().int().min(0).nullish(),
  rentCadence: z.enum(["WEEKLY", "MONTHLY"]).nullish(),
};

// W-2 needs both commission rates; 1099 needs rent + cadence.
const compRefine = (d: {
  employmentType: "W2" | "1099";
  serviceCommissionBps?: number | null;
  retailCommissionBps?: number | null;
  rentAmountCents?: number | null;
  rentCadence?: "WEEKLY" | "MONTHLY" | null;
}): boolean =>
  d.employmentType === "W2"
    ? d.serviceCommissionBps != null && d.retailCommissionBps != null
    : d.rentAmountCents != null && d.rentCadence != null;

const compMsg =
  "W-2 requires serviceCommissionBps + retailCommissionBps; 1099 requires rentAmountCents + rentCadence";

const createStaffSchema = z
  .object({
    salonId: z.string().uuid(),
    fullName: z.string().min(1),
    email: z.string().email().nullish(),
    role: z.enum(["OWNER", "ADMIN", "TECH"]).optional(),
    actorStaffId: z.string().uuid().nullish(),
    ...compShape,
  })
  .refine(compRefine, { message: compMsg });

const updateCompSchema = z
  .object({
    salonId: z.string().uuid(),
    actorStaffId: z.string().uuid().nullish(),
    ...compShape,
  })
  .refine(compRefine, { message: compMsg });

const apptStatus = z.enum(["BOOKED", "IN_CHAIR", "DONE", "CANCELLED", "NO_SHOW"]);

const createApptSchema = z.object({
  salonId: z.string().uuid(),
  techId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
  clientLabel: z.string().nullish(),
  serviceDesc: z.string().nullish(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullish(),
  actorStaffId: z.string().uuid().nullish(),
});

export function createApp() {
  const app = express();

  // Stripe webhook needs the RAW body for signature verification — register it
  // BEFORE express.json() so the parser doesn't consume the body. Public route.
  app.post("/webhooks/stripe", express.raw({ type: "*/*" }), (req, res) => {
    stripeWebhookHandler(req, res).catch(() => res.status(500).end());
  });

  app.use(express.json());

  // CORS — open in dev so the browser UI (different origin) can call the API.
  // Lock the allowed origin down before production.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", (req.headers.origin as string) || process.env.CORS_ORIGIN || "*");
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Friendly public root so hitting the base URL isn't a scary auth error.
  app.get("/", (_req, res) =>
    res.json({ service: "Nail Salon POS API", ok: true, health: "/health" })
  );

  // --- Auth (public) ---
  app.post(
    "/auth/login",
    h(async (req, res) => {
      const body = z
        .object({ email: z.string().email(), password: z.string().min(1) })
        .parse(req.body);
      res.json(await login(body.email, body.password));
    })
  );

  // Self-serve tenant signup: creates a new salon + owner login, returns tokens.
  app.post(
    "/auth/register-salon",
    h(async (req, res) => {
      const body = z
        .object({
          salonName: z.string().min(1).max(120),
          ownerName: z.string().min(1).max(120),
          ownerEmail: z.string().email(),
          password: z.string().min(6).max(200),
          timezone: z.string().min(1).max(64).optional(),
        })
        .parse(req.body);
      res.status(201).json(await registerSalon(body));
    })
  );

  app.post(
    "/auth/refresh",
    h(async (req, res) => {
      const body = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
      res.json(await refresh(body.refreshToken));
    })
  );

  app.post(
    "/auth/logout",
    h(async (req, res) => {
      const body = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
      await logout(body.refreshToken);
      res.status(204).end();
    })
  );

  // Everything below this line requires a valid bearer token.
  app.use(requireAuth);

  app.get(
    "/auth/me",
    h(async (req, res) => {
      res.json(await me(getAuth(req).staffId));
    })
  );

  // --- Reads (salon-scoped) ---
  app.get(
    "/salons/:salonId/settings",
    h(async (req, res) => {
      assertSalon(req, req.params.salonId);
      res.json(await getCurrentConfig(pool, req.params.salonId));
    })
  );

  app.get(
    "/staff/:staffId",
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertStaffInSalon(req, req.params.staffId);
      // A tech may only read their own full profile (pay rates).
      if (auth.role === "TECH" && auth.staffId !== req.params.staffId) {
        throw new HttpError(403, "Can only view your own profile");
      }
      res.json(await getStaffWithProfile(pool, req.params.staffId));
    })
  );

  app.get(
    "/salons/:salonId/staff",
    h(async (req, res) => {
      const auth = getAuth(req);
      assertSalon(req, req.params.salonId);
      const rows = await listStaffWithProfiles(pool, req.params.salonId);
      const isManager = auth.role === "OWNER" || auth.role === "ADMIN";
      // Techs get the roster (names/type for scheduling) but not other people's
      // pay rates — only their own row keeps commission/rent figures.
      const scoped = isManager
        ? rows
        : rows.map((r) =>
            r.id === auth.staffId
              ? r
              : { ...r, serviceCommissionBps: 0, retailCommissionBps: 0, rentCents: r.rentCents === null ? null : 0 }
          );
      res.json(scoped);
    })
  );

  app.get(
    "/salons/:salonId/tickets",
    h(async (req, res) => {
      const auth = getAuth(req);
      assertSalon(req, req.params.salonId);
      const q = z.object({ date: dateStr }).parse(req.query);
      // Techs only see their own tickets; managers see the whole salon.
      const techId = auth.role === "TECH" ? auth.staffId : undefined;
      res.json(await getTicketsForDay(pool, req.params.salonId, q.date, techId));
    })
  );

  // Salon-local calendar — the server is authoritative for "today" and the
  // workweek Monday so the UI never has to guess the timezone.
  app.get(
    "/salons/:salonId/calendar",
    h(async (req, res) => {
      assertSalon(req, req.params.salonId);
      const tz = (await getCurrentConfig(pool, req.params.salonId)).timezone;
      res.json({ timezone: tz, today: todayInTz(tz), weekStart: workweekStartInTz(tz) });
    })
  );

  // --- Checkout (any authenticated staff in the salon) ---
  app.post(
    "/checkout",
    h(async (req, res) => {
      const auth = getAuth(req);
      const input = checkoutSchema.parse(req.body);
      await assertStaffInSalon(req, input.techId); // tech must belong to caller's salon
      const result = await checkout({ ...input, actorStaffId: auth.staffId });
      res.status(201).json(result);
    })
  );

  // --- Payroll + tip pool (owner/admin only) ---
  app.get(
    "/payroll/workweek",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const q = z
        .object({
          salonId: z.string().uuid(),
          techId: z.string().uuid().optional(),
          start: dateStr,
        })
        .parse(req.query);
      assertSalon(req, q.salonId);
      const data = q.techId
        ? await computeWorkweek(q.salonId, q.techId, q.start)
        : await computeWorkweekForSalon(q.salonId, q.start);
      res.json(data);
    })
  );

  app.get(
    "/tip-pool",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const q = z
        .object({ salonId: z.string().uuid(), date: dateStr })
        .parse(req.query);
      assertSalon(req, q.salonId);
      res.json(await computeDailyPool(q.salonId, q.date));
    })
  );

  // Persist (commit) computed payroll / tip pool. salonId comes from the token.
  app.post(
    "/payroll/commit",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      const { start } = z.object({ start: dateStr }).parse(req.body);
      const result = await generateAndPersistWorkweek(auth.salonId, start, auth.staffId);
      res.status(201).json(result);
    })
  );

  app.post(
    "/tip-pool/commit",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      const { date } = z.object({ date: dateStr }).parse(req.body);
      const result = await persistDailyPool(auth.salonId, date, auth.staffId);
      res.status(201).json(result);
    })
  );

  // --- Admin: settings + staff (owner/admin only) ---
  app.put(
    "/salons/:salonId/settings",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      assertSalon(req, req.params.salonId);
      const config = settingsSchema.parse(req.body);
      // Preserve the existing timezone if the client didn't send one.
      if (!config.timezone) {
        config.timezone = (await getCurrentConfig(pool, req.params.salonId)).timezone;
      }
      res.json(await updateSettings(req.params.salonId, config, getAuth(req).staffId));
    })
  );

  app.post(
    "/staff",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      const input = createStaffSchema.parse(req.body);
      // Ignore any client-supplied salonId — force the caller's salon.
      const result = await createStaff({ ...input, salonId: auth.salonId }, auth.staffId);
      res.status(201).json(result);
    })
  );

  // Set or reset a staff member's login password (owner/admin, same salon).
  app.post(
    "/staff/:staffId/credential",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertStaffInSalon(req, req.params.staffId);
      const { password } = z
        .object({ password: z.string().min(6).max(200) })
        .parse(req.body);
      await setStaffPassword(auth.salonId, req.params.staffId, password, auth.staffId);
      res.status(204).end();
    })
  );

  app.patch(
    "/staff/:staffId/comp",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertStaffInSalon(req, req.params.staffId);
      const input = updateCompSchema.parse(req.body);
      await updateStaffComp(req.params.staffId, { ...input, salonId: auth.salonId }, auth.staffId);
      res.status(204).end();
    })
  );

  // --- Time clock (W-2). Techs clock themselves; managers may clock anyone. ---
  app.post(
    "/time-clock/in",
    h(async (req, res) => {
      const auth = getAuth(req);
      const body = z.object({ techId: z.string().uuid().optional() }).parse(req.body ?? {});
      const techId = body.techId ?? auth.staffId;
      if (auth.role === "TECH" && techId !== auth.staffId) {
        throw new HttpError(403, "Can only clock yourself in");
      }
      await assertStaffInSalon(req, techId);
      res.status(201).json(await clockIn(auth.salonId, techId));
    })
  );

  app.post(
    "/time-clock/out",
    h(async (req, res) => {
      const auth = getAuth(req);
      const body = z.object({ techId: z.string().uuid().optional() }).parse(req.body ?? {});
      const techId = body.techId ?? auth.staffId;
      if (auth.role === "TECH" && techId !== auth.staffId) {
        throw new HttpError(403, "Can only clock yourself out");
      }
      await assertStaffInSalon(req, techId);
      res.json(await clockOut(techId));
    })
  );

  app.get(
    "/time-clock/status",
    h(async (req, res) => {
      const auth = getAuth(req);
      const q = z
        .object({ techId: z.string().uuid().optional(), date: dateStr.optional() })
        .parse(req.query);
      const techId = q.techId ?? auth.staffId;
      if (auth.role === "TECH" && techId !== auth.staffId) {
        throw new HttpError(403, "Can only view your own clock");
      }
      await assertStaffInSalon(req, techId);
      res.json(await getStatus(techId, q.date));
    })
  );

  // --- Appointments (any authenticated staff in the salon) ---
  app.get(
    "/salons/:salonId/appointments",
    h(async (req, res) => {
      assertSalon(req, req.params.salonId);
      const q = z.object({ date: dateStr }).parse(req.query);
      res.json(await listForDay(req.params.salonId, q.date));
    })
  );

  app.post(
    "/appointments",
    h(async (req, res) => {
      const auth = getAuth(req);
      const input = createApptSchema.parse(req.body);
      await assertStaffInSalon(req, input.techId);
      const result = await createAppointment({ ...input, salonId: auth.salonId });
      res.status(201).json(result);
    })
  );

  app.patch(
    "/appointments/:id/status",
    h(async (req, res) => {
      await assertAppointmentInSalon(req, req.params.id);
      const { status } = z.object({ status: apptStatus }).parse(req.body);
      const updated = await setStatus(req.params.id, status);
      if (!updated) {
        res.status(404).json({ error: "NotFound" });
        return;
      }
      res.json(updated);
    })
  );

  // --- Error handler ---
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "ValidationError", details: err.issues });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: "AuthError", message: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "InternalError", message });
  });

  return app;
}
