import Stripe from "stripe";
import {
  PaymentProvider,
  RentChargeRequest,
  TransferRequest,
  TransferResult,
} from "./PaymentProvider";

/**
 * Stripe Connect implementation of the payment boundary.
 *
 * Model:
 *  - Service payouts to a 1099 contractor = a Transfer from the platform balance
 *    to the contractor's connected account (`destinationAccountId`). The
 *    connected account then pays out to its bank on its own schedule (set the
 *    account to instant/daily payouts in Stripe). Transfers settle to the
 *    connected balance immediately on success; failures/reversals arrive by
 *    webhook (`transfer.reversed`).
 *  - Chair rent = a PaymentIntent charged to the renter's saved payment method
 *    (`sourceAccountId` is the Stripe customer id). Async result by webhook
 *    (`payment_intent.succeeded` / `.payment_failed`).
 *
 * Requires STRIPE_SECRET_KEY. The connected account / customer ids live in
 * `payment_accounts.external_account_id` (set during Connect onboarding — TODO).
 */
export class StripeConnectProvider implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    // apiVersion omitted so the SDK uses the version its types are pinned to.
    this.stripe = new Stripe(key);
  }

  async createTransfer(req: TransferRequest): Promise<TransferResult> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: req.amountCents,
        currency: "usd",
        destination: req.destinationAccountId,
        description: req.description,
        metadata: req.metadata ?? {},
        transfer_group: req.idempotencyKey,
      },
      { idempotencyKey: `tr_${req.idempotencyKey}` }
    );
    // A created transfer has moved funds to the connected balance.
    return { externalId: transfer.id, status: "PAID" };
  }

  async chargeRent(req: RentChargeRequest): Promise<TransferResult> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: req.amountCents,
        currency: "usd",
        customer: req.sourceAccountId,
        description: req.description,
        metadata: req.metadata ?? {},
        confirm: true,
        off_session: true,
      },
      { idempotencyKey: `rent_${req.idempotencyKey}` }
    );
    return { externalId: pi.id, status: mapPaymentIntentStatus(pi.status) };
  }
}

function mapPaymentIntentStatus(
  s: Stripe.PaymentIntent.Status
): "PENDING" | "PAID" | "FAILED" {
  if (s === "succeeded") return "PAID";
  if (s === "canceled" || s === "requires_payment_method") return "FAILED";
  return "PENDING";
}
