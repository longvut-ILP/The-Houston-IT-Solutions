/**
 * Provider-agnostic payments boundary. The salon's payment provider is
 * undecided, so all money movement goes through this interface. Swap in a
 * StripeConnectProvider or SquareProvider later without touching services.
 */
export type Cents = number;

export interface TransferRequest {
  /** Idempotency key — reuse the ticket/charge id so retries don't double-pay. */
  idempotencyKey: string;
  amountCents: Cents;
  /** Provider account id of the destination (e.g. Stripe connected account). */
  destinationAccountId: string;
  description?: string;
  /** Echoed back on webhooks so we can find the row to update (e.g. payoutId). */
  metadata?: Record<string, string>;
}

export interface TransferResult {
  externalId: string;
  status: "PENDING" | "PAID" | "FAILED";
}

export interface RentChargeRequest {
  idempotencyKey: string;
  amountCents: Cents;
  /** Provider customer/account to charge. */
  sourceAccountId: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: string;
  /** Route a service payout to a 1099 contractor's connected bank account. */
  createTransfer(req: TransferRequest): Promise<TransferResult>;
  /** Charge a booth renter's recurring chair rent. */
  chargeRent(req: RentChargeRequest): Promise<TransferResult>;
}
