import { pool, withTx } from "../db/pool";
import { getCurrentConfig } from "../repositories/settingsRepo";
import { getItemPrices } from "../repositories/menuRepo";
import {
  insertOrder,
  listOrders,
  setOrderStatus,
  bumpItem,
  recordPayment,
  applyOrderPaymentTotals,
  salesSince,
  PersistLine,
} from "../repositories/orderRepo";
import { insertAudit } from "../repositories/auditRepo";
import { computeOrderTotals, lineTotalCents, OrderLineInput } from "../lib/orderEngine";
import { HttpError } from "../auth/middleware";

export interface NewOrderLine {
  menuItemId: string;
  quantity: number;
  notes?: string | null;
  modifiers?: { name: string; priceDeltaCents: number }[];
}

/**
 * Create an order. Prices come from the DB (the client can't set its own
 * prices); tax is computed from current settings. `send` fires it to the
 * kitchen immediately (quick-service default).
 */
export async function createOrder(
  restaurantId: string,
  createdBy: string,
  input: { customerLabel?: string | null; send: boolean; lines: NewOrderLine[] }
) {
  if (!input.lines.length) throw new HttpError(400, "Order has no items");
  const cfg = await getCurrentConfig(pool, restaurantId);
  const prices = await getItemPrices(
    pool,
    restaurantId,
    input.lines.map((l) => l.menuItemId)
  );

  const engineLines: OrderLineInput[] = [];
  const persistLines: PersistLine[] = [];
  for (const l of input.lines) {
    const item = prices.get(l.menuItemId);
    if (!item) throw new HttpError(400, `Unknown menu item ${l.menuItemId}`);
    if (l.quantity <= 0) throw new HttpError(400, "Quantity must be positive");
    const modDeltas = (l.modifiers ?? []).map((m) => Math.round(m.priceDeltaCents));
    const eLine: OrderLineInput = {
      unitPriceCents: item.priceCents,
      quantity: l.quantity,
      modifierDeltasCents: modDeltas,
    };
    engineLines.push(eLine);
    persistLines.push({
      menuItemId: l.menuItemId,
      nameSnapshot: item.name,
      unitPriceCents: item.priceCents,
      quantity: l.quantity,
      lineTotalCents: lineTotalCents(eLine),
      notes: l.notes ?? null,
      modifiers: (l.modifiers ?? []).map((m) => ({
        modifierId: null,
        nameSnapshot: m.name,
        priceDeltaCents: Math.round(m.priceDeltaCents),
      })),
    });
  }
  const totals = computeOrderTotals(engineLines, cfg);

  const result = await withTx(async (db) => {
    const r = await insertOrder(db, {
      restaurantId,
      customerLabel: input.customerLabel ?? null,
      status: input.send ? "IN_KITCHEN" : "OPEN",
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      createdBy,
      lines: persistLines,
    });
    await insertAudit(db, {
      restaurantId,
      actorStaffId: createdBy,
      entityType: "order",
      entityId: r.orderId,
      action: "CREATE",
      after: { orderNumber: r.orderNumber, subtotal: totals.subtotalCents, sent: input.send },
    });
    return r;
  });
  return { ...result, ...totals };
}

export const listOrdersByStatus = (restaurantId: string, statuses: string[]) =>
  listOrders(pool, restaurantId, statuses);

/** Fire an OPEN order to the kitchen. */
export async function sendToKitchen(restaurantId: string, orderId: string, actor: string) {
  await setOrderStatus(pool, orderId, "IN_KITCHEN", { markSent: true });
  await insertAudit(pool, {
    restaurantId,
    actorStaffId: actor,
    entityType: "order",
    entityId: orderId,
    action: "SEND",
  });
}

/** Kitchen marks the whole order ready (bumps all its items + status READY). */
export async function markOrderReady(restaurantId: string, orderId: string, actor: string) {
  await withTx(async (db) => {
    await db.query(
      `UPDATE order_items SET kitchen_status = 'READY' WHERE order_id = $1`,
      [orderId]
    );
    await setOrderStatus(db, orderId, "READY");
    await insertAudit(db, {
      restaurantId,
      actorStaffId: actor,
      entityType: "order",
      entityId: orderId,
      action: "READY",
    });
  });
}

export const bumpOrderItem = (orderItemId: string, status: "QUEUED" | "READY") =>
  bumpItem(pool, orderItemId, status);

/** Take payment for an order: tip + card fee + total, then mark COMPLETED. */
export async function checkout(
  restaurantId: string,
  orderId: string,
  actor: string,
  input: { method: "CARD" | "CASH"; tipCents: number }
) {
  const cfg = await getCurrentConfig(pool, restaurantId);
  const { rows } = await pool.query<{
    status: string;
    subtotal_cents: string;
    tax_cents: string;
  }>(`SELECT status, subtotal_cents, tax_cents FROM orders WHERE id = $1`, [orderId]);
  if (rows.length === 0) throw new HttpError(404, "Order not found");
  const o = rows[0];
  if (o.status === "COMPLETED") throw new HttpError(409, "Order already paid");
  if (o.status === "VOIDED") throw new HttpError(409, "Order was voided");

  const subtotalCents = Number(o.subtotal_cents);
  const taxCents = Number(o.tax_cents);
  const tipCents = Math.max(0, Math.round(input.tipCents));
  const totalCents = subtotalCents + taxCents + tipCents;
  const cardFeeCents =
    input.method === "CARD"
      ? Math.round((totalCents * cfg.ccFeePctBps) / 10000) + cfg.ccFeeFixedCents
      : 0;

  const paymentId = await withTx(async (db) => {
    const pid = await recordPayment(db, {
      restaurantId,
      orderId,
      method: input.method,
      amountCents: totalCents,
      tipCents,
      cardFeeCents,
      createdBy: actor,
    });
    await applyOrderPaymentTotals(db, orderId, tipCents, cardFeeCents, totalCents);
    await setOrderStatus(db, orderId, "COMPLETED", { markClosed: true });
    await insertAudit(db, {
      restaurantId,
      actorStaffId: actor,
      entityType: "payment",
      entityId: pid,
      action: "PAY",
      after: { method: input.method, totalCents, tipCents, cardFeeCents },
    });
    return pid;
  });
  return { paymentId, subtotalCents, taxCents, tipCents, cardFeeCents, totalCents };
}

export const reportSince = (restaurantId: string, sinceIso: string) =>
  salesSince(pool, restaurantId, sinceIso);
