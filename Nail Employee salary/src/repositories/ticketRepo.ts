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
}

export async function insertTicket(db: Db, p: InsertTicketParams): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tickets
       (salon_id, tech_id, appointment_id, status, employment_type_snapshot,
        snap_cc_fee_pct_bps, snap_cc_fee_fixed_cents, snap_product_cost_pct_bps,
        snap_service_commission_bps, snap_retail_commission_bps, completed_at)
     VALUES ($1,$2,$3,'COMPLETED',$4,$5,$6,$7,$8,$9, now())
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
