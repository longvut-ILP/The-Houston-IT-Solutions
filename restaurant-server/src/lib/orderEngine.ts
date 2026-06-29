// Pure money math for the restaurant POS. All money is integer CENTS; all rates
// are basis points (bps): 1% = 100 bps. Rounding is always Math.round so the
// API, tests and UI agree to the penny.

export type PaymentMethod = "CARD" | "CASH";

export interface OrderLineInput {
  unitPriceCents: number; // menu price at time of order
  quantity: number;
  /** per-unit modifier deltas, e.g. +$0.50 extra shot */
  modifierDeltasCents?: number[];
}

export interface RestaurantConfig {
  taxPctBps: number; // sales tax, e.g. 825 = 8.25%
  ccFeePctBps: number; // card processing %, e.g. 290 = 2.9%
  ccFeeFixedCents: number; // card processing fixed, e.g. 30
}

/** Apply a basis-point rate to a cents amount, rounded to the nearest cent. */
export const applyBps = (cents: number, bps: number): number =>
  Math.round((cents * bps) / 10000);

/** One line's total: (unit price + sum of per-unit modifiers) * quantity. */
export function lineTotalCents(line: OrderLineInput): number {
  const mods = (line.modifierDeltasCents ?? []).reduce((a, b) => a + b, 0);
  return (line.unitPriceCents + mods) * line.quantity;
}

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  /** merchant card-processing cost (reporting only; not added to the total) */
  cardFeeCents: number;
  /** what the customer pays: subtotal + tax + tip */
  totalCents: number;
}

/**
 * Totals for an order. Tax applies to the subtotal. The customer total is
 * subtotal + tax + tip. The card fee is the merchant's processing cost on the
 * amount charged (only for CARD) — tracked for reporting, never added on top.
 */
export function computeOrderTotals(
  lines: OrderLineInput[],
  cfg: RestaurantConfig,
  opts: { tipCents?: number; method?: PaymentMethod } = {}
): OrderTotals {
  const tipCents = Math.max(0, Math.round(opts.tipCents ?? 0));
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const taxCents = applyBps(subtotalCents, cfg.taxPctBps);
  const totalCents = subtotalCents + taxCents + tipCents;
  const cardFeeCents =
    opts.method === "CARD" ? applyBps(totalCents, cfg.ccFeePctBps) + cfg.ccFeeFixedCents : 0;
  return { subtotalCents, taxCents, tipCents, cardFeeCents, totalCents };
}

/** Format integer cents as a $ string (UI/debug helper). */
export const fmt = (cents: number): string =>
  (cents < 0 ? "-$" : "$") + (Math.abs(cents) / 100).toFixed(2);
