import { pool, withTx } from "../db/pool";
import { getCurrentConfig } from "../repositories/settingsRepo";
import { getStaffWithProfile } from "../repositories/staffRepo";
import * as ticketRepo from "../repositories/ticketRepo";
import { getPaymentProvider } from "../payments/MockPaymentProvider";
import {
  computeRenterPayout,
  computeW2Ticket,
  Ticket,
} from "../lib/commissionEngine";

export interface CheckoutLineItem {
  kind: "SERVICE" | "RETAIL";
  description?: string;
  quantity?: number;
  amountCents: number; // extended amount (already qty * unit)
}
export interface CheckoutTip {
  method: "CARD" | "CASH";
  amountCents: number;
}
export interface CheckoutInput {
  techId: string;
  appointmentId?: string | null;
  lineItems: CheckoutLineItem[];
  tips?: CheckoutTip[];
  actorStaffId?: string | null;
}

export interface CheckoutResult {
  ticketId: string;
  path: "W2" | "1099";
  breakdown: Record<string, number>;
  payoutId?: string;
  payoutStatus?: string;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * Checkout orchestration. Loads the tech's pay profile + current salon config,
 * runs the commission engine, and persists everything atomically. For a 1099
 * renter the external payout is initiated AFTER the DB commit (so we never hold
 * a transaction open across a network call), then the payout row's status is
 * updated — which the schema permits.
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const staff = await getStaffWithProfile(pool, input.techId);
  const config = await getCurrentConfig(pool, staff.salonId);

  const serviceRevenue = sum(
    input.lineItems.filter((l) => l.kind === "SERVICE").map((l) => l.amountCents)
  );
  const retailRevenue = sum(
    input.lineItems.filter((l) => l.kind === "RETAIL").map((l) => l.amountCents)
  );
  const tips = input.tips ?? [];
  const ccTip = sum(tips.filter((t) => t.method === "CARD").map((t) => t.amountCents));
  const cashTip = sum(tips.filter((t) => t.method === "CASH").map((t) => t.amountCents));

  const ticket: Ticket = {
    serviceRevenueCents: serviceRevenue,
    retailRevenueCents: retailRevenue,
    ccTipCents: ccTip,
    cashTipCents: cashTip,
  };

  const isW2 = staff.tech.employmentType === "W2";

  const persisted = await withTx(async (db) => {
    const ticketId = await ticketRepo.insertTicket(db, {
      salonId: staff.salonId,
      techId: input.techId,
      appointmentId: input.appointmentId ?? null,
      employmentType: staff.tech.employmentType,
      snapCcFeePctBps: config.ccFeePctBps,
      snapCcFeeFixedCents: config.ccFeeFixedCents,
      snapProductCostPctBps: config.productCostPctBps,
      snapServiceCommissionBps: isW2 ? staff.tech.serviceCommissionBps : null,
      snapRetailCommissionBps: isW2 ? staff.tech.retailCommissionBps : null,
    });

    for (const l of input.lineItems) {
      await ticketRepo.insertLineItem(
        db, ticketId, l.kind, l.description ?? null, l.quantity ?? 1, l.amountCents
      );
    }
    await ticketRepo.insertTip(db, ticketId, "CARD", ccTip);
    await ticketRepo.insertTip(db, ticketId, "CASH", cashTip);

    // Card charge into the salon's merchant account (service + retail + card tip).
    await ticketRepo.insertLedger(db, {
      salonId: staff.salonId,
      kind: "CARD_CHARGE",
      amountCents: serviceRevenue + retailRevenue + ccTip,
      ticketId,
      status: "PAID",
    });

    let breakdown: Record<string, number>;
    let payoutId: string | undefined;

    if (isW2) {
      const b = computeW2Ticket(ticket, staff.tech, config);
      await ticketRepo.insertCommissionRecord(db, {
        ticketId,
        techId: input.techId,
        grossServiceCents: serviceRevenue,
        ccFeeOnServiceCents: b.ccFeeOnServiceCents,
        productCostCents: b.productCostCents,
        netServiceCents: b.netServiceRevenueCents,
        serviceCommissionCents: b.serviceCommissionCents,
        retailRevenueCents: retailRevenue,
        retailCommissionCents: b.retailCommissionCents,
        commissionWagesCents: b.commissionWagesCents,
        cardTipCents: b.cardTipCents,
        cashTipCents: b.cashTipCents,
      });
      breakdown = {
        ccFeeOnServiceCents: b.ccFeeOnServiceCents,
        productCostCents: b.productCostCents,
        netServiceRevenueCents: b.netServiceRevenueCents,
        serviceCommissionCents: b.serviceCommissionCents,
        retailCommissionCents: b.retailCommissionCents,
        commissionWagesCents: b.commissionWagesCents,
        cardTipCents: b.cardTipCents,
        cashTipCents: b.cashTipCents,
        techTakeHomeCents: b.techTakeHomeCents,
      };
    } else {
      const p = computeRenterPayout(ticket, config);
      payoutId = await ticketRepo.insertPayoutRecord(db, {
        ticketId,
        techId: input.techId,
        grossServiceCents: serviceRevenue,
        cardTipCents: ccTip,
        cardFeeCents: p.cardFeeCents,
        instantPayoutCents: p.instantPayoutCents,
        cashTipCents: cashTip,
        salonRetailCents: p.salonRetailRevenueCents,
        provider: getPaymentProvider().name,
        providerTransferId: null,
        status: "PENDING",
      });
      // Outgoing payout from merchant account to contractor.
      await ticketRepo.insertLedger(db, {
        salonId: staff.salonId,
        kind: "INSTANT_PAYOUT",
        amountCents: -p.instantPayoutCents,
        ticketId,
        payoutId,
        status: "PENDING",
      });
      breakdown = {
        cardFeeCents: p.cardFeeCents,
        instantPayoutCents: p.instantPayoutCents,
        cashTipCents: p.cashTipCents,
        salonRetailCents: p.salonRetailRevenueCents,
      };
    }

    if (input.appointmentId) {
      await ticketRepo.markAppointmentDone(db, input.appointmentId);
    }
    await ticketRepo.insertAudit(db, {
      salonId: staff.salonId,
      actorStaffId: input.actorStaffId ?? null,
      entityType: "ticket",
      entityId: ticketId,
      action: "CHECKOUT",
      after: { path: isW2 ? "W2" : "1099", ...breakdown },
    });

    return { ticketId, breakdown, payoutId };
  });

  // 1099 instant payout: call the provider after commit, then record result.
  let payoutStatus: string | undefined;
  if (!isW2 && persisted.payoutId) {
    const provider = getPaymentProvider();
    const acct = await getPayoutAccount(input.techId);
    const tr = await provider.createTransfer({
      idempotencyKey: persisted.payoutId,
      amountCents: persisted.breakdown.instantPayoutCents,
      destinationAccountId: acct ?? "mock_account",
      description: `Service payout ticket ${persisted.ticketId}`,
      metadata: { payoutId: persisted.payoutId, ticketId: persisted.ticketId },
    });
    payoutStatus = tr.status;
    await pool.query(
      `UPDATE payout_records SET provider_transfer_id = $1, status = $2 WHERE id = $3`,
      [tr.externalId, tr.status, persisted.payoutId]
    );
    await pool.query(
      `UPDATE payment_transactions SET external_id = $1, status = $2 WHERE payout_id = $3`,
      [tr.externalId, tr.status, persisted.payoutId]
    );
  }

  return {
    ticketId: persisted.ticketId,
    path: isW2 ? "W2" : "1099",
    breakdown: persisted.breakdown,
    payoutId: persisted.payoutId,
    payoutStatus,
  };
}

async function getPayoutAccount(staffId: string): Promise<string | null> {
  const { rows } = await pool.query<{ external_account_id: string }>(
    `SELECT external_account_id FROM payment_accounts
      WHERE staff_id = $1 AND is_active ORDER BY created_at DESC LIMIT 1`,
    [staffId]
  );
  return rows.length ? rows[0].external_account_id : null;
}
