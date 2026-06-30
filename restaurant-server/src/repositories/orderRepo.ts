import { Db } from "../db/pool";
import { PoolClient } from "pg";

export interface PersistLine {
  menuItemId: string | null;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  notes?: string | null;
  modifiers?: { modifierId: string | null; nameSnapshot: string; priceDeltaCents: number }[];
}

export interface PersistOrderInput {
  restaurantId: string;
  customerLabel?: string | null;
  status: "OPEN" | "IN_KITCHEN";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  createdBy: string;
  lines: PersistLine[];
}

/** Atomically allocate the next order number for a restaurant. */
async function nextOrderNumber(db: PoolClient, restaurantId: string): Promise<number> {
  const { rows } = await db.query<{ next_number: number }>(
    `INSERT INTO order_counters (restaurant_id, next_number) VALUES ($1, 2)
     ON CONFLICT (restaurant_id)
       DO UPDATE SET next_number = order_counters.next_number + 1
     RETURNING next_number - 1 AS next_number`,
    [restaurantId]
  );
  return rows[0].next_number;
}

/** Insert an order, its items and modifiers in one transaction. */
export async function insertOrder(
  db: PoolClient,
  input: PersistOrderInput
): Promise<{ orderId: string; orderNumber: number }> {
  const orderNumber = await nextOrderNumber(db, input.restaurantId);
  const sentAt = input.status === "IN_KITCHEN" ? "now()" : "NULL";
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO orders
       (restaurant_id, order_number, status, customer_label,
        subtotal_cents, tax_cents, tip_cents, card_fee_cents, total_cents, created_by, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,0,0,$7,$8, ${sentAt})
     RETURNING id`,
    [
      input.restaurantId,
      orderNumber,
      input.status,
      input.customerLabel ?? null,
      input.subtotalCents,
      input.taxCents,
      input.totalCents,
      input.createdBy,
    ]
  );
  const orderId = rows[0].id;
  for (const l of input.lines) {
    const { rows: ir } = await db.query<{ id: string }>(
      `INSERT INTO order_items
         (order_id, menu_item_id, name_snapshot, unit_price_cents, quantity, line_total_cents, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [orderId, l.menuItemId, l.nameSnapshot, l.unitPriceCents, l.quantity, l.lineTotalCents, l.notes ?? null]
    );
    const itemId = ir[0].id;
    for (const m of l.modifiers ?? []) {
      await db.query(
        `INSERT INTO order_item_modifiers (order_item_id, modifier_id, name_snapshot, price_delta_cents)
         VALUES ($1,$2,$3,$4)`,
        [itemId, m.modifierId, m.nameSnapshot, m.priceDeltaCents]
      );
    }
  }
  return { orderId, orderNumber };
}

export interface OrderSummary {
  id: string;
  orderNumber: number;
  status: string;
  customerLabel: string | null;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  createdAt: string;
  sentAt: string | null;
}

function mapOrder(r: any): OrderSummary {
  return {
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    customerLabel: r.customer_label,
    subtotalCents: Number(r.subtotal_cents),
    taxCents: Number(r.tax_cents),
    tipCents: Number(r.tip_cents),
    totalCents: Number(r.total_cents),
    createdAt: r.created_at,
    sentAt: r.sent_at,
  };
}

/** Orders in given statuses (newest first), with their line items. */
export async function listOrders(
  db: Db,
  restaurantId: string,
  statuses: string[]
): Promise<(OrderSummary & { items: any[] })[]> {
  const { rows } = await db.query(
    `SELECT * FROM orders
      WHERE restaurant_id = $1 AND status = ANY($2::order_status[])
      ORDER BY created_at ASC`,
    [restaurantId, statuses]
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r: any) => r.id);
  const { rows: items } = await db.query(
    `SELECT id, order_id, name_snapshot, unit_price_cents, quantity, line_total_cents,
            kitchen_status, notes
       FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY created_at`,
    [ids]
  );
  const byOrder = new Map<string, any[]>();
  for (const it of items) {
    const arr = byOrder.get(it.order_id) ?? [];
    arr.push({
      id: it.id,
      name: it.name_snapshot,
      unitPriceCents: Number(it.unit_price_cents),
      quantity: it.quantity,
      lineTotalCents: Number(it.line_total_cents),
      kitchenStatus: it.kitchen_status,
      notes: it.notes,
    });
    byOrder.set(it.order_id, arr);
  }
  return rows.map((r: any) => ({ ...mapOrder(r), items: byOrder.get(r.id) ?? [] }));
}

export async function setOrderStatus(
  db: Db,
  orderId: string,
  status: string,
  opts: { markSent?: boolean; markClosed?: boolean } = {}
): Promise<void> {
  await db.query(
    `UPDATE orders SET status = $2::order_status,
        sent_at = CASE WHEN $3 THEN now() ELSE sent_at END,
        closed_at = CASE WHEN $4 THEN now() ELSE closed_at END
      WHERE id = $1`,
    [orderId, status, !!opts.markSent, !!opts.markClosed]
  );
}

export async function bumpItem(db: Db, orderItemId: string, status: "QUEUED" | "READY"): Promise<void> {
  await db.query(`UPDATE order_items SET kitchen_status = $2::kitchen_status WHERE id = $1`, [
    orderItemId,
    status,
  ]);
}

export async function recordPayment(
  db: Db,
  p: {
    restaurantId: string;
    orderId: string;
    method: "CARD" | "CASH";
    amountCents: number;
    tipCents: number;
    cardFeeCents: number;
    discountCents: number;
    createdBy: string;
  }
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payments (restaurant_id, order_id, method, amount_cents, tip_cents, card_fee_cents, discount_cents, created_by)
     VALUES ($1,$2,$3::payment_method,$4,$5,$6,$7,$8) RETURNING id`,
    [p.restaurantId, p.orderId, p.method, p.amountCents, p.tipCents, p.cardFeeCents, p.discountCents, p.createdBy]
  );
  return rows[0].id;
}

/** Persist discount/tip/card-fee/total onto the order at payment time. */
export async function applyOrderPaymentTotals(
  db: Db,
  orderId: string,
  v: { discountCents: number; tipCents: number; cardFeeCents: number; totalCents: number }
): Promise<void> {
  await db.query(
    `UPDATE orders SET discount_cents = $2, tip_cents = $3, card_fee_cents = $4, total_cents = $5 WHERE id = $1`,
    [orderId, v.discountCents, v.tipCents, v.cardFeeCents, v.totalCents]
  );
}

// ---- editing an existing order (before it's paid) ----

/** Append line items to an existing order. */
export async function insertOrderItems(
  db: Db,
  orderId: string,
  lines: PersistLine[]
): Promise<void> {
  for (const l of lines) {
    await db.query(
      `INSERT INTO order_items
         (order_id, menu_item_id, name_snapshot, unit_price_cents, quantity, line_total_cents, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orderId, l.menuItemId, l.nameSnapshot, l.unitPriceCents, l.quantity, l.lineTotalCents, l.notes ?? null]
    );
  }
}

export async function updateItemQuantity(db: Db, orderItemId: string, quantity: number): Promise<void> {
  await db.query(
    `UPDATE order_items SET quantity = $2::int, line_total_cents = unit_price_cents * $2::int WHERE id = $1`,
    [orderItemId, quantity]
  );
}

export async function deleteOrderItem(db: Db, orderItemId: string): Promise<void> {
  await db.query(`DELETE FROM order_items WHERE id = $1`, [orderItemId]);
}

/** Recompute subtotal/tax/total for an order from its current items. */
export async function recomputeOrderTotals(
  db: Db,
  orderId: string,
  taxBps: number
): Promise<{ subtotalCents: number; taxCents: number }> {
  const { rows } = await db.query<{ sub: string }>(
    `SELECT COALESCE(SUM(line_total_cents),0) AS sub FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  const subtotalCents = Number(rows[0].sub);
  const taxCents = Math.round((subtotalCents * taxBps) / 10000);
  const totalCents = subtotalCents + taxCents;
  await db.query(
    `UPDATE orders SET subtotal_cents = $2, tax_cents = $3, total_cents = $4 WHERE id = $1`,
    [orderId, subtotalCents, taxCents, totalCents]
  );
  return { subtotalCents, taxCents };
}

export async function getOrderStatus(db: Db, orderId: string): Promise<string | null> {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
  return rows[0]?.status ?? null;
}

export function orderIdForItem(db: Db, orderItemId: string): Promise<string | null> {
  return db
    .query<{ order_id: string }>(`SELECT order_id FROM order_items WHERE id = $1`, [orderItemId])
    .then((r) => r.rows[0]?.order_id ?? null);
}

/** Sales report rows for a day (by local date range in UTC bounds). */
export async function salesSince(
  db: Db,
  restaurantId: string,
  sinceIso: string
): Promise<{
  orders: number;
  grossCents: number;
  taxCents: number;
  tipCents: number;
  cardFeeCents: number;
  byMethod: { method: string; count: number; amountCents: number }[];
}> {
  const { rows: tot } = await db.query<{
    orders: string;
    gross: string | null;
    tax: string | null;
    tip: string | null;
    fee: string | null;
  }>(
    `SELECT COUNT(*) AS orders,
            SUM(amount_cents) AS gross,
            SUM(0) AS tax,
            SUM(tip_cents) AS tip,
            SUM(card_fee_cents) AS fee
       FROM payments WHERE restaurant_id = $1 AND created_at >= $2`,
    [restaurantId, sinceIso]
  );
  const { rows: bm } = await db.query<{ method: string; count: string; amount: string }>(
    `SELECT method, COUNT(*) AS count, SUM(amount_cents) AS amount
       FROM payments WHERE restaurant_id = $1 AND created_at >= $2
      GROUP BY method`,
    [restaurantId, sinceIso]
  );
  return {
    orders: Number(tot[0].orders),
    grossCents: Number(tot[0].gross ?? 0),
    taxCents: Number(tot[0].tax ?? 0),
    tipCents: Number(tot[0].tip ?? 0),
    cardFeeCents: Number(tot[0].fee ?? 0),
    byMethod: bm.map((r) => ({
      method: r.method,
      count: Number(r.count),
      amountCents: Number(r.amount),
    })),
  };
}

export function orderItemRestaurant(db: Db, orderItemId: string) {
  return db
    .query<{ restaurant_id: string }>(
      `SELECT o.restaurant_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = $1`,
      [orderItemId]
    )
    .then((r) => r.rows[0]?.restaurant_id ?? null);
}
