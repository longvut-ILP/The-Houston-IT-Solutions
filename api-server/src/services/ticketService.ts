import { pool, withTx } from "../db/pool";
import * as ticketRepo from "../repositories/ticketRepo";
import { HttpError } from "../auth/middleware";

/**
 * Void a completed ticket the append-only way: mark it VOIDED (which removes it
 * from every revenue/commission/payroll/tip aggregation, since those all filter
 * status = 'COMPLETED'), reverse the card charge with a REFUND ledger entry, and
 * for a 1099 ticket flip the payout to REVERSED and post a clawback. Nothing is
 * deleted; the original records stay for the audit trail.
 */
export async function voidTicket(
  salonId: string,
  ticketId: string,
  actorStaffId: string,
  reason?: string | null
): Promise<{ ok: true; path: "W2" | "1099" }> {
  const basics = await ticketRepo.getTicketBasics(pool, ticketId);
  if (!basics) throw new HttpError(404, "Ticket not found");
  if (basics.salonId !== salonId) throw new HttpError(403, "Cross-salon access denied");
  if (basics.status === "VOIDED") throw new HttpError(409, "Ticket is already voided");
  if (basics.status !== "COMPLETED") throw new HttpError(409, "Only completed tickets can be voided");

  const is1099 = basics.employmentType !== "W2";

  await withTx(async (db) => {
    await ticketRepo.markTicketVoided(db, ticketId);

    // Reverse the card charge collected for this ticket.
    const cardCharge = await ticketRepo.getCardChargeCents(db, ticketId);
    if (cardCharge > 0) {
      await ticketRepo.insertLedger(db, {
        salonId,
        kind: "REFUND",
        amountCents: -cardCharge,
        ticketId,
        status: "PAID",
      });
    }

    // 1099: flip the payout to REVERSED and claw the instant payout back.
    if (is1099) {
      const clawback = await ticketRepo.reversePayout(db, ticketId);
      if (clawback > 0) {
        await ticketRepo.insertLedger(db, {
          salonId,
          kind: "ADJUSTMENT",
          amountCents: clawback, // positive: money returns to the salon account
          ticketId,
          status: "PENDING",
        });
      }
    }

    await ticketRepo.insertAudit(db, {
      salonId,
      actorStaffId,
      entityType: "ticket",
      entityId: ticketId,
      action: "VOID",
      after: { status: "VOIDED", reason: reason ?? null },
    });
  });

  return { ok: true, path: is1099 ? "1099" : "W2" };
}

export const listDaySales = (salonId: string, date: string) =>
  ticketRepo.listDayTickets(pool, salonId, date);
