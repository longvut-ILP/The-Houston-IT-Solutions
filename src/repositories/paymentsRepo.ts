import { Db } from "../db/pool";

type PayoutStatus = "PENDING" | "PAID" | "FAILED" | "REVERSED";

/** Update a payout's status (and optionally its provider id). Status UPDATE is
 *  permitted by the append-only triggers; DELETE is not. */
export async function setPayoutStatus(
  db: Db,
  payoutId: string,
  status: PayoutStatus,
  providerTransferId?: string
): Promise<void> {
  await db.query(
    `UPDATE payout_records
        SET status = $2,
            provider_transfer_id = COALESCE($3, provider_transfer_id)
      WHERE id = $1`,
    [payoutId, status, providerTransferId ?? null]
  );
}

export async function setLedgerStatusByPayoutId(
  db: Db,
  payoutId: string,
  status: PayoutStatus
): Promise<void> {
  await db.query(
    `UPDATE payment_transactions SET status = $2 WHERE payout_id = $1`,
    [payoutId, status]
  );
}

export async function setRentChargeStatus(
  db: Db,
  rentChargeId: string,
  status: PayoutStatus,
  providerInvoiceId?: string
): Promise<void> {
  await db.query(
    `UPDATE rent_charges
        SET status = $2,
            provider_invoice_id = COALESCE($3, provider_invoice_id)
      WHERE id = $1`,
    [rentChargeId, status, providerInvoiceId ?? null]
  );
}
