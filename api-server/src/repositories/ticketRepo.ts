import { Db } from "../db/pool";

/** engine enum -> DB enum for storage. */
export function toDbEmployment(engineValue: "W2" | "1099"): string {
  return engineValue === "W2" ? "W2" : "CONTRACTOR_1099";
}

export interface InsertTicketParams {
  salonId: string;
  techId: string;
  appointmentId: string | null;
  employmentType: "W2" | "1099";
  snapCcFeePctBps: number;
  snapCcFeeFixedCents: number;
  snapProductCostPctBps: number;
  snapServiceCommissionBps: number | null;
  snapRetailCommissionBps: number | null;
  discountCents?: number;
  discountAppliesTo?: string | null;
  discountAbsorb?: string | null;
  discountReason?: string | null;
}

export async function insertTicket(db: Db, p: InsertTicketParams): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tickets
       (salon_id, tech_id, appointment_id, status, employment_type_snapshot,
        snap_cc_fee_pct_bps, snap_cc_fee_fixed_cents, snap_product_cost_pct_bps,
        snap_service_commission_bps, snap_retail_commission_bps,
        discount_cents, discount_applies_to, discount_absorb, discount_reason, completed_at)
     VALUES ($1,$2,$3,'COMPLETED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     RETURNING id`,
    [
      p.salonId,
      p.techId,
      p.appointmentId,
      toDbEmployment(p.employmentType),
      p.snapCcFeePctBps,
      p.snapCcFeeFixedCents,
      p.snapProductCostPctBps,
      p.snapServiceCommissionBps,
      p.snapRetailCommissionBps,
      p.discountCents ?? 0,
      p.discountAppliesTo ?? null,
      p.discountAbsorb ?? null,
      p.discountReason ?? null,
    ]
  );
  return rows[0].id;
}

export async function insertLineItem(
  db: Db,
  ticketId: string,
  kind: "SERVICE" | "RETAIL",
  description: string | null,
  quantity: number,
  amountCents: number
): Promise<void> {
  await db.query(
    `INSERT INTO ticket_line_items (ticket_id, kind, description, quantity, amount_cents)
     VALUES ($1,$2,$3,$4,$5)`,
    [ticketId, kind, description, quantity, amountCents]
  );
}

export async function insertTip(
  db: Db,
  ticketId: string,
  method: "CARD" | "CASH",
  amountCents: number
): Promise<void> {
  if (amountCents <= 0) return;
  await db.query(
    `INSERT INTO ticket_tips (ticket_id, method, amount_cents) VALUES ($1,$2,$3)`,
    [ticketId, method, amountCents]
  );
}

export interface CommissionRecordParams {
  ticketId: string;
  techId: string;
  grossServiceCents: number;
  ccFeeOnServiceCents: number;
  productCostCents: number;
  netServiceCents: number;
  serviceCommissionCents: number;
  retailRevenueCents: number;
  retailCommissionCents: number;
  commissionWagesCents: number;
  cardTipCents: number;
  cashTipCents: number;
}

export async function insertCommissionRecord(
  db: Db,
  p: CommissionRecordParams
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO commission_records
       (ticket_id, tech_id, gross_service_cents, cc_fee_on_service_cents,
        product_cost_cents, net_service_cents, service_commission_cents,
        retail_revenue_cents, retail_commission_cents, commission_wages_cents,
        card_tip_cents, cash_tip_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      p.ticketId, p.techId, p.grossServiceCents, p.ccFeeOnServiceCents,
      p.productCostCents, p.netServiceCents, p.serviceCommissionCents,
      p.retailRevenueCents, p.retailCommissionCents, p.commissionWagesCents,
      p.cardTipCents, p.cashTipCents,
    ]
  );
  return rows[0].id;
}

export interface PayoutRecordParams {
  ticketId: string;
  techId: string;
  grossServiceCents: number;
  cardTipCents: number;
  cardFeeCents: number;
  instantPayoutCents: number;
  cashTipCents: number;
  salonRetailCents: number;
  provider: string | null;
  providerTransferId: string | null;
  status: "PENDING" | "PAID" | "FAILED" | "REVERSED";
}

export async function insertPayoutRecord(
  db: Db,
  p: PayoutRecordParams
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payout_records
       (ticket_id, tech_id, gross_service_cents, card_tip_cents, card_fee_cents,
        instant_payout_cents, cash_tip_cents, salon_retail_cents,
        provider, provider_transfer_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      p.ticketId, p.techId, p.grossServiceCents, p.cardTipCents, p.cardFeeCents,
      p.instantPayoutCents, p.cashTipCents, p.salonRetailCents,
      p.provider, p.providerTransferId, p.status,
    ]
  );
  return rows[0].id;
}

export async function insertLedger(
  db: Db,
  params: {
    salonId: string;
    kind: "CARD_CHARGE" | "INSTANT_PAYOUT" | "RENT_CHARGE" | "REFUND" | "ADJUSTMENT";
    amountCents: number;
    ticketId?: string | null;
    payoutId?: string | null;
    provider?: string | null;
    externalId?: string | null;
    status?: "PENDING" | "PAID" | "FAILED" | "REVERSED";
  }
): Promise<void> {
  await db.query(
    `INSERT INTO payment_transactions
       (salon_id, kind, ticket_id, payout_id, amount_cents, provider, external_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      params.salonId,
      params.kind,
      params.ticketId ?? null,
      params.payoutId ?? null,
      params.amountCents,
      params.provider ?? null,
      params.externalId ?? null,
      params.status ?? "PENDING",
    ]
  );
}

export async function insertAudit(
  db: Db,
  params: {
    salonId: string;
    actorStaffId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    after: unknown;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (salon_id, actor_staff_id, entity_type, entity_id, action, after_json)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      params.salonId,
      params.actorStaffId,
      params.entityType,
      params.entityId,
      params.action,
      JSON.stringify(params.after),
    ]
  );
}

export async function markAppointmentDone(
  db: Db,
  appointmentId: string
): Promise<void> {
  await db.query(
    `UPDATE appointments SET status = 'DONE' WHERE id = $1`,
    [appointmentId]
  );
}

// ---- void / reversal ----

export interface TicketBasics {
  salonId: string;
  status: string;
  techId: string;
  employmentType: string; // 'W2' | 'CONTRACTOR_1099'
}

export async function getTicketBasics(db: Db, ticketId: string): Promise<TicketBasics | null> {
  const { rows } = await db.query<{
    salon_id: string;
    status: string;
    tech_id: string;
    employment_type_snapshot: string;
  }>(
    `SELECT salon_id, status, tech_id, employment_type_snapshot FROM tickets WHERE id = $1`,
    [ticketId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { salonId: r.salon_id, status: r.status, techId: r.tech_id, employmentType: r.employment_type_snapshot };
}

/** Mark a ticket VOIDED. Tickets are not append-only, so this UPDATE is allowed. */
export async function markTicketVoided(db: Db, ticketId: string): Promise<void> {
  await db.query(`UPDATE tickets SET status = 'VOIDED' WHERE id = $1`, [ticketId]);
}

/** The card charge originally posted for a ticket (to reverse it on void). */
export async function getCardChargeCents(db: Db, ticketId: string): Promise<number> {
  const { rows } = await db.query<{ amount_cents: string }>(
    `SELECT amount_cents FROM payment_transactions
      WHERE ticket_id = $1 AND kind = 'CARD_CHARGE' ORDER BY created_at LIMIT 1`,
    [ticketId]
  );
  return rows.length ? Number(rows[0].amount_cents) : 0;
}

/** Flip a 1099 payout to REVERSED and return what was paid out (for clawback). */
export async function reversePayout(db: Db, ticketId: string): Promise<number> {
  const { rows } = await db.query<{ instant_payout_cents: string }>(
    `UPDATE payout_records SET status = 'REVERSED'
      WHERE ticket_id = $1 AND status <> 'REVERSED'
      RETURNING instant_payout_cents`,
    [ticketId]
  );
  return rows.length ? Number(rows[0].instant_payout_cents) : 0;
}

export interface SaleRow {
  id: string;
  techId: string;
  techName: string;
  status: string;
  service: number;
  retail: number;
  ccTip: number;
  cashTip: number;
  discountCents: number;
  createdAt: string;
}

/** All tickets for a day (any status) with tech name — powers the void list. */
export async function listDayTickets(db: Db, salonId: string, date: string): Promise<SaleRow[]> {
  const { rows } = await db.query<{
    id: string;
    tech_id: string;
    name: string;
    status: string;
    service: string;
    retail: string;
    cctip: string;
    cashtip: string;
    discount_cents: string;
    created_at: string;
  }>(
    `SELECT t.id, t.tech_id, s.full_name AS name, t.status,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_line_items WHERE ticket_id = t.id AND kind='SERVICE'),0) AS service,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_line_items WHERE ticket_id = t.id AND kind='RETAIL'),0) AS retail,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_tips WHERE ticket_id = t.id AND method='CARD'),0) AS cctip,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_tips WHERE ticket_id = t.id AND method='CASH'),0) AS cashtip,
            COALESCE(t.discount_cents,0) AS discount_cents, t.created_at
       FROM tickets t JOIN staff s ON s.id = t.tech_id
      WHERE t.salon_id = $1 AND t.status <> 'OPEN'
        AND t.created_at >= $2::date AND t.created_at < ($2::date + INTERVAL '1 day')
      ORDER BY t.created_at DESC`,
    [salonId, date]
  );
  return rows.map((r) => ({
    id: r.id,
    techId: r.tech_id,
    techName: r.name,
    status: r.status,
    service: Number(r.service),
    retail: Number(r.retail),
    ccTip: Number(r.cctip),
    cashTip: Number(r.cashtip),
    discountCents: Number(r.discount_cents),
    createdAt: r.created_at,
  }));
}
