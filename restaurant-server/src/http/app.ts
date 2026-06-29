import express, { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pool, withTx } from "../db/pool";
import {
  HttpError,
  requireAuth,
  requireRole,
  getAuth,
  assertRestaurant,
  assertStaffInRestaurant,
  assertOrderInRestaurant,
} from "../auth/middleware";
import { login, me, registerRestaurant, createStaff, setStaffPassword } from "../services/authService";
import {
  createOrder,
  listOrdersByStatus,
  sendToKitchen,
  markOrderReady,
  bumpOrderItem,
  checkout,
  reportSince,
} from "../services/orderService";
import { getMenu, insertCategory, insertItem, updateItem, itemRestaurant } from "../repositories/menuRepo";
import { getCurrentConfig, replaceCurrentConfig } from "../repositories/settingsRepo";
import { listStaff } from "../repositories/staffRepo";
import { orderItemRestaurant } from "../repositories/orderRepo";
import { insertAudit } from "../repositories/auditRepo";

const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const lineSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  notes: z.string().max(280).nullish(),
  modifiers: z
    .array(z.object({ name: z.string().min(1), priceDeltaCents: z.number().int() }))
    .optional(),
});

export function createApp() {
  const app = express();
  app.use(express.json());

  // CORS — reflect origin so the browser app (different origin) can call us.
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
  app.get("/", (_req, res) =>
    res.json({ service: "Restaurant POS API", ok: true, health: "/health" })
  );

  // --- Auth (public) ---
  app.post(
    "/auth/login",
    h(async (req, res) => {
      const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
      res.json(await login(b.email, b.password));
    })
  );

  app.post(
    "/auth/register-restaurant",
    h(async (req, res) => {
      const b = z
        .object({
          restaurantName: z.string().min(1).max(120),
          ownerName: z.string().min(1).max(120),
          ownerEmail: z.string().email(),
          password: z.string().min(6).max(200),
          timezone: z.string().min(1).max(64).optional(),
        })
        .parse(req.body);
      res.status(201).json(await registerRestaurant(b));
    })
  );

  // Everything below requires a valid token.
  app.use(requireAuth);

  app.get(
    "/auth/me",
    h(async (req, res) => {
      res.json(await me(getAuth(req).staffId));
    })
  );

  // --- Menu (read: any staff; write: owner/admin) ---
  app.get(
    "/restaurants/:rid/menu",
    h(async (req, res) => {
      assertRestaurant(req, req.params.rid);
      res.json(await getMenu(pool, req.params.rid));
    })
  );

  app.post(
    "/menu/categories",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const b = z.object({ name: z.string().min(1), sortOrder: z.number().int().optional() }).parse(req.body);
      const id = await insertCategory(pool, getAuth(req).restaurantId, b.name, b.sortOrder ?? 0);
      res.status(201).json({ id });
    })
  );

  app.post(
    "/menu/items",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const b = z
        .object({
          categoryId: z.string().uuid().nullish(),
          name: z.string().min(1),
          priceCents: z.number().int().min(0),
          sortOrder: z.number().int().optional(),
        })
        .parse(req.body);
      const id = await insertItem(pool, getAuth(req).restaurantId, {
        categoryId: b.categoryId ?? null,
        name: b.name,
        priceCents: b.priceCents,
        sortOrder: b.sortOrder ?? 0,
      });
      res.status(201).json({ id });
    })
  );

  app.patch(
    "/menu/items/:id",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      const owner = await itemRestaurant(pool, req.params.id);
      if (owner !== auth.restaurantId) throw new HttpError(403, "Cross-restaurant access denied");
      const b = z
        .object({
          name: z.string().min(1).optional(),
          priceCents: z.number().int().min(0).optional(),
          isActive: z.boolean().optional(),
          categoryId: z.string().uuid().nullish(),
        })
        .parse(req.body);
      await updateItem(pool, req.params.id, b);
      res.status(204).end();
    })
  );

  // --- Settings ---
  app.get(
    "/restaurants/:rid/settings",
    h(async (req, res) => {
      assertRestaurant(req, req.params.rid);
      res.json(await getCurrentConfig(pool, req.params.rid));
    })
  );

  app.put(
    "/restaurants/:rid/settings",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      assertRestaurant(req, req.params.rid);
      const b = z
        .object({
          taxPctBps: z.number().int().min(0).max(10000),
          ccFeePctBps: z.number().int().min(0).max(10000),
          ccFeeFixedCents: z.number().int().min(0),
        })
        .parse(req.body);
      await withTx(async (db) => {
        await replaceCurrentConfig(db, req.params.rid, b);
        await insertAudit(db, {
          restaurantId: req.params.rid,
          actorStaffId: getAuth(req).staffId,
          entityType: "settings",
          entityId: req.params.rid,
          action: "UPDATE",
          after: b,
        });
      });
      res.json(b);
    })
  );

  // --- Staff (owner/admin) ---
  app.get(
    "/restaurants/:rid/staff",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      assertRestaurant(req, req.params.rid);
      res.json(await listStaff(pool, req.params.rid));
    })
  );

  app.post(
    "/staff",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      const b = z
        .object({
          fullName: z.string().min(1),
          email: z.string().email().nullish(),
          role: z.enum(["OWNER", "ADMIN", "STAFF"]).optional(),
          password: z.string().min(6).max(200).optional(),
        })
        .parse(req.body);
      res.status(201).json(await createStaff(auth.restaurantId, b, auth.staffId));
    })
  );

  app.post(
    "/staff/:id/credential",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertStaffInRestaurant(req, req.params.id);
      const b = z.object({ password: z.string().min(6).max(200) }).parse(req.body);
      await setStaffPassword(auth.restaurantId, req.params.id, b.password, auth.staffId);
      res.status(204).end();
    })
  );

  // --- Orders ---
  app.post(
    "/orders",
    h(async (req, res) => {
      const auth = getAuth(req);
      const b = z
        .object({
          customerLabel: z.string().max(80).nullish(),
          send: z.boolean().optional(),
          lines: z.array(lineSchema).min(1),
        })
        .parse(req.body);
      const result = await createOrder(auth.restaurantId, auth.staffId, {
        customerLabel: b.customerLabel ?? null,
        send: b.send ?? true,
        lines: b.lines,
      });
      res.status(201).json(result);
    })
  );

  app.get(
    "/orders",
    h(async (req, res) => {
      const auth = getAuth(req);
      const statusStr = (req.query.status as string) || "OPEN,IN_KITCHEN,READY";
      const statuses = statusStr.split(",").map((s) => s.trim()).filter(Boolean);
      res.json(await listOrdersByStatus(auth.restaurantId, statuses));
    })
  );

  app.post(
    "/orders/:id/send",
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertOrderInRestaurant(req, req.params.id);
      await sendToKitchen(auth.restaurantId, req.params.id, auth.staffId);
      res.status(204).end();
    })
  );

  app.post(
    "/orders/:id/ready",
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertOrderInRestaurant(req, req.params.id);
      await markOrderReady(auth.restaurantId, req.params.id, auth.staffId);
      res.status(204).end();
    })
  );

  app.post(
    "/order-items/:id/bump",
    h(async (req, res) => {
      const auth = getAuth(req);
      const owner = await orderItemRestaurant(pool, req.params.id);
      if (owner !== auth.restaurantId) throw new HttpError(403, "Cross-restaurant access denied");
      const b = z.object({ status: z.enum(["QUEUED", "READY"]) }).parse(req.body);
      await bumpOrderItem(req.params.id, b.status);
      res.status(204).end();
    })
  );

  app.post(
    "/orders/:id/checkout",
    h(async (req, res) => {
      const auth = getAuth(req);
      await assertOrderInRestaurant(req, req.params.id);
      const b = z
        .object({ method: z.enum(["CARD", "CASH"]), tipCents: z.number().int().min(0) })
        .parse(req.body);
      res.json(await checkout(auth.restaurantId, req.params.id, auth.staffId, b));
    })
  );

  // --- Reports ---
  app.get(
    "/reports/sales",
    requireRole("OWNER", "ADMIN"),
    h(async (req, res) => {
      const auth = getAuth(req);
      const since = (req.query.since as string) || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      res.json(await reportSince(auth.restaurantId, since));
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
