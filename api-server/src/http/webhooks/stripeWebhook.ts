import { Request, Response } from "express";
import Stripe from "stripe";
import { pool } from "../../db/pool";
import {
  setLedgerStatusByPayoutId,
  setPayoutStatus,
  setRentChargeStatus,
} from "../../repositories/paymentsRepo";

/**
 * Stripe webhook receiver. Requires the RAW request body (registered with
 * express.raw before the JSON parser) so the signature can be verified.
 *
 * We reconcile async results back onto our rows using the `metadata` we set
 * when creating the transfer/PaymentIntent (payoutId / rentChargeId).
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!whSecret || !key) {
    res.status(500).send("Stripe webhook not configured");
    return;
  }
  const stripe = new Stripe(key);
  const sig = req.header("stripe-signature") || "";

  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (express.raw).
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    res.status(400).send(`Webhook signature verification failed: ${msg}`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = event.data.object as any;
  const meta: Record<string, string> = obj?.metadata ?? {};

  try {
    switch (event.type) {
      case "transfer.reversed": {
        if (meta.payoutId) {
          await setPayoutStatus(pool, meta.payoutId, "REVERSED");
          await setLedgerStatusByPayoutId(pool, meta.payoutId, "REVERSED");
        }
        break;
      }
      case "payment_intent.succeeded": {
        if (meta.rentChargeId) await setRentChargeStatus(pool, meta.rentChargeId, "PAID", obj.id);
        break;
      }
      case "payment_intent.payment_failed": {
        if (meta.rentChargeId) await setRentChargeStatus(pool, meta.rentChargeId, "FAILED", obj.id);
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    // Returning 500 makes Stripe retry the event later.
    const msg = err instanceof Error ? err.message : "handler error";
    res.status(500).json({ error: msg });
  }
}
