import { randomUUID } from "crypto";
import {
  PaymentProvider,
  RentChargeRequest,
  TransferRequest,
  TransferResult,
} from "./PaymentProvider";

/**
 * No-op provider used until a real one (Stripe Connect / Square) is wired.
 * Returns a synthetic external id and PAID status so the checkout flow can be
 * exercised end-to-end. Replace by implementing PaymentProvider for the chosen
 * vendor; nothing else in the codebase changes.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createTransfer(req: TransferRequest): Promise<TransferResult> {
    return { externalId: `mock_tr_${randomUUID()}`, status: "PAID" };
  }

  async chargeRent(req: RentChargeRequest): Promise<TransferResult> {
    return { externalId: `mock_rent_${randomUUID()}`, status: "PAID" };
  }
}

/** Factory — reads PAYMENT_PROVIDER and returns the configured provider.
 *  Stripe is required lazily so the `stripe` SDK / key are only needed when
 *  actually selected (mock installs run without them). */
export function getPaymentProvider(): PaymentProvider {
  switch (process.env.PAYMENT_PROVIDER) {
    case "stripe": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { StripeConnectProvider } = require("./StripeConnectProvider");
      return new StripeConnectProvider();
    }
    default:
      return new MockPaymentProvider();
  }
}
