/**
 * commissionEngine.ts
 * ---------------------------------------------------------------------------
 * Pure, framework-agnostic financial logic for the Nail Salon POS.
 *
 * Design rules (read before editing):
 *  1. ALL money is stored and computed as integer CENTS. Never use floats for
 *     money. The only division is the bps helper, which rounds back to a cent.
 *  2. Rates are stored in BASIS POINTS (bps). 1% = 100 bps, 50% = 5000 bps.
 *     This keeps every input an integer and avoids 0.1 + 0.2 style drift.
 *  3. Functions here are PURE. No I/O, no Date.now(), no randomness. This file
 *     is the single source of truth shared by the UI and the (future) backend
 *     so the number a tech sees on their dashboard equals the number payroll
 *     pays out.
 *
 * IMPORTANT legal distinction baked into the model:
 *   - W-2 employees earn a COMMISSION SPLIT of net revenue, and are protected
 *     by the FLSA minimum-wage floor + overtime regular-rate rules.
 *   - 1099 booth renters DO NOT get a commission split. They keep their full
 *     gross service revenue (minus card fees) and instead pay flat chair rent.
 *     The salon's margin on a renter comes from rent, not from a revenue cut.
 *   These are different code paths on purpose. Do not merge them.
 * ---------------------------------------------------------------------------
 */

export type Cents = number; // integer
export type Bps = number; // basis points; 10000 = 100%
export type EmploymentType = "W2" | "1099";

/** Salon-wide settings configured by the Owner/Admin. */
export interface SalonConfig {
  /** Card processing fee, percentage portion, in bps (e.g. 290 = 2.9%). */
  ccFeePctBps: Bps;
  /** Card processing fee, fixed per-transaction portion (e.g. 30 = $0.30). */
  ccFeeFixedCents: Cents;
  /** Product/back-bar cost deduction applied to SERVICE revenue, in bps
   *  (PRD: usually 800–1500 = 8%–15%). */
  productCostPctBps: Bps;
  /** Local minimum wage, cents per hour (e.g. 1600 = $16.00). */
  minWageCentsPerHour: Cents;
  /** When true, W-2 staff card tips are pooled and split by hours worked. */
  tipPoolingEnabled: boolean;
  /** IANA timezone for workweek/day anchoring (e.g. "America/New_York"). */
  timezone?: string;
}

/** Per-technician settings configured on their profile. */
export interface TechConfig {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /** Service commission rate in bps (PRD: 4000–6000). W-2 only. */
  serviceCommissionBps: Bps;
  /** Retail commission rate in bps (PRD: 1000–1500). W-2 only. */
  retailCommissionBps: Bps;
}

/** A single checkout ticket. */
export interface Ticket {
  serviceRevenueCents: Cents; // labor
  retailRevenueCents: Cents; // physical product
  ccTipCents: Cents; // gratuity via card
  cashTipCents: Cents; // gratuity handed to tech directly
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

/** Apply a basis-point rate to a cents amount, rounding to the nearest cent. */
export function applyBps(amountCents: Cents, rateBps: Bps): Cents {
  // Math.round is half-up for positive values; amounts here are non-negative.
  return Math.round((amountCents * rateBps) / 10000);
}

/**
 * Card processing fee on a charged amount. Percentage portion is rounded to
 * the cent; the fixed portion is added once. Callers decide what `amount` is
 * (e.g. only the service+tip slice routed to a renter).
 */
export function cardFee(amountCents: Cents, cfg: SalonConfig): Cents {
  if (amountCents <= 0) return 0;
  return applyBps(amountCents, cfg.ccFeePctBps) + cfg.ccFeeFixedCents;
}

// ---------------------------------------------------------------------------
// Per-ticket commission (W-2 path)
// ---------------------------------------------------------------------------

export interface W2TicketBreakdown {
  ccFeeOnServiceCents: Cents;
  productCostCents: Cents;
  netServiceRevenueCents: Cents;
  serviceCommissionCents: Cents;
  retailCommissionCents: Cents;
  /** Tip the tech is owed for THIS ticket (before any pooling redistribution). */
  cardTipCents: Cents;
  cashTipCents: Cents;
  /** Commission wages from this ticket (service + retail). Excludes tips. */
  commissionWagesCents: Cents;
  /** What the tech nets from this ticket incl. tips, pre-pooling. */
  techTakeHomeCents: Cents;
}

/**
 * Commission engine for a W-2 employee, executed at checkout.
 * Sequence mirrors the PRD:
 *   1. Net_Service = Gross_Service - CC fee(service) - Product cost(service)
 *   2. Service commission = Net_Service * tech service %
 *   3. Retail commission  = Retail * tech retail %
 */
export function computeW2Ticket(
  ticket: Ticket,
  tech: TechConfig,
  cfg: SalonConfig
): W2TicketBreakdown {
  const ccFeeOnService = cardFee(ticket.serviceRevenueCents, cfg);
  const productCost = applyBps(ticket.serviceRevenueCents, cfg.productCostPctBps);
  const netService = Math.max(
    0,
    ticket.serviceRevenueCents - ccFeeOnService - productCost
  );

  const serviceCommission = applyBps(netService, tech.serviceCommissionBps);
  const retailCommission = applyBps(
    ticket.retailRevenueCents,
    tech.retailCommissionBps
  );
  const commissionWages = serviceCommission + retailCommission;

  return {
    ccFeeOnServiceCents: ccFeeOnService,
    productCostCents: productCost,
    netServiceRevenueCents: netService,
    serviceCommissionCents: serviceCommission,
    retailCommissionCents: retailCommission,
    cardTipCents: ticket.ccTipCents,
    cashTipCents: ticket.cashTipCents,
    commissionWagesCents: commissionWages,
    techTakeHomeCents:
      commissionWages + ticket.ccTipCents + ticket.cashTipCents,
  };
}

// ---------------------------------------------------------------------------
// Discounts / corrections
// ---------------------------------------------------------------------------

export type DiscountAppliesTo = "TICKET" | "SERVICE";

/**
 * Return a copy of the ticket with `discountCents` removed from the revenue the
 * commission/payout is computed on. Tips are never discounted. For "SERVICE" the
 * cut comes only off service revenue; for "TICKET" it's split across service and
 * retail in proportion to their amounts. The discount is clamped so revenue
 * never goes negative. This is used only when the TECH shares the discount; when
 * the HOUSE absorbs it, the caller passes the original (undiscounted) ticket to
 * the engine so the tech's commission is unaffected.
 */
export function discountedTicket(
  ticket: Ticket,
  discountCents: Cents,
  appliesTo: DiscountAppliesTo
): Ticket {
  const d = Math.max(0, Math.round(discountCents));
  if (d <= 0) return ticket;
  const svc = ticket.serviceRevenueCents;
  const rtl = ticket.retailRevenueCents;
  if (appliesTo === "SERVICE") {
    const dS = Math.min(d, svc);
    return { ...ticket, serviceRevenueCents: svc - dS };
  }
  const base = svc + rtl;
  if (base <= 0) return ticket;
  const dCap = Math.min(d, base);
  const dS = Math.round((dCap * svc) / base);
  const dR = dCap - dS;
  return {
    ...ticket,
    serviceRevenueCents: svc - dS,
    retailRevenueCents: rtl - dR,
  };
}

// ---------------------------------------------------------------------------
// Per-ticket payout (1099 booth-renter path)
// ---------------------------------------------------------------------------

export interface Renter1099Payout {
  /** Routed to the contractor's bank: gross service + card tip - card fees. */
  instantPayoutCents: Cents;
  cardFeeCents: Cents;
  cashTipCents: Cents; // already in the renter's pocket; tracked only
  /** Retail belongs to the salon for a booth renter (no commission split). */
  salonRetailRevenueCents: Cents;
}

/**
 * Booth renter checkout. No commission split — the renter keeps gross service
 * revenue plus the card tip, net of the card fee on that slice. Chair rent is
 * billed separately (see computeRent). Retail sold stays with the salon.
 */
export function computeRenterPayout(
  ticket: Ticket,
  cfg: SalonConfig
): Renter1099Payout {
  const routable = ticket.serviceRevenueCents + ticket.ccTipCents;
  const fee = cardFee(routable, cfg);
  return {
    instantPayoutCents: Math.max(0, routable - fee),
    cardFeeCents: fee,
    cashTipCents: ticket.cashTipCents,
    salonRetailRevenueCents: ticket.retailRevenueCents,
  };
}

// ---------------------------------------------------------------------------
// FLSA: minimum-wage floor + overtime (W-2 payroll period)
// ---------------------------------------------------------------------------

export interface FlsaInput {
  /** Sum of commission wages (service + retail) earned in the workweek. */
  commissionWagesCents: Cents;
  hoursWorked: number; // decimal hours, e.g. 43.5
  minWageCentsPerHour: Cents;
}

export interface FlsaResult {
  minWageFloorCents: Cents;
  /** Top-up added if commissions fell below the min-wage floor. */
  minWageTopUpCents: Cents;
  /** Straight-time earnings after the floor is applied. */
  straightTimeCents: Cents;
  overtimeHours: number;
  /** Regular rate = straight-time pay / all hours worked. */
  regularRateCentsPerHour: Cents;
  /** Half-time premium owed on OT hours (straight time already counted). */
  overtimePremiumCents: Cents;
  grossPayCents: Cents;
}

const STANDARD_WORKWEEK_HOURS = 40;

/**
 * FLSA pay calculation for ONE 7-day workweek.
 *
 * Two protections, applied in order:
 *   1. Minimum-wage floor: if commission wages < hours * min wage, top up to
 *      the floor. (Tips are NOT counted toward the floor here — this models a
 *      salon that pays full minimum wage and lets techs keep tips on top. If
 *      you intend to take an FLSA tip credit, that's a different calc.)
 *   2. Overtime: for hours over 40, the OT premium is HALF the regular rate
 *      (straight time is already included in the commission/floor), where
 *      regularRate = straightTimePay / totalHours. This is the FLSA method for
 *      commissioned employees, not a naive 1.5x base wage.
 */
export function computeFlsaWorkweek(input: FlsaInput): FlsaResult {
  const { commissionWagesCents, hoursWorked, minWageCentsPerHour } = input;

  const minWageFloor = Math.round(hoursWorked * minWageCentsPerHour);
  const topUp = Math.max(0, minWageFloor - commissionWagesCents);
  const straightTime = commissionWagesCents + topUp; // === max(commission, floor)

  const overtimeHours = Math.max(0, hoursWorked - STANDARD_WORKWEEK_HOURS);

  let regularRate = 0;
  let overtimePremium = 0;
  if (hoursWorked > 0) {
    regularRate = Math.round(straightTime / hoursWorked);
    if (overtimeHours > 0) {
      overtimePremium = Math.round(0.5 * regularRate * overtimeHours);
    }
  }

  return {
    minWageFloorCents: minWageFloor,
    minWageTopUpCents: topUp,
    straightTimeCents: straightTime,
    overtimeHours,
    regularRateCentsPerHour: regularRate,
    overtimePremiumCents: overtimePremium,
    grossPayCents: straightTime + overtimePremium,
  };
}

// ---------------------------------------------------------------------------
// Tip pooling (W-2 only) and rent (1099 only)
// ---------------------------------------------------------------------------

export interface PoolShare {
  techId: string;
  hours: number;
  shareCents: Cents;
}

/**
 * Pool card tips and split by hours worked that day. Largest-remainder method
 * so the parts sum EXACTLY to the pool (no lost or invented cents).
 * Only pass W-2 staff here — pooling a 1099 contractor's tips is not allowed.
 */
export function poolTipsByHours(
  totalTipCents: Cents,
  participants: { techId: string; hours: number }[]
): PoolShare[] {
  const totalHours = participants.reduce((s, p) => s + p.hours, 0);
  if (totalHours <= 0 || totalTipCents <= 0) {
    return participants.map((p) => ({ ...p, shareCents: 0 }));
  }

  const raw = participants.map((p) => {
    const exact = (totalTipCents * p.hours) / totalHours;
    const floorCents = Math.floor(exact);
    return { ...p, floorCents, remainder: exact - floorCents };
  });

  let distributed = raw.reduce((s, r) => s + r.floorCents, 0);
  let leftover = totalTipCents - distributed;

  // Hand out the leftover cents to the largest remainders first.
  raw.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < raw.length && leftover > 0; i++) {
    raw[i].floorCents += 1;
    leftover -= 1;
  }

  return raw.map((r) => ({
    techId: r.techId,
    hours: r.hours,
    shareCents: r.floorCents,
  }));
}

export type RentCadence = "weekly" | "monthly";

/** Flat chair rent for a booth renter (PRD: $150–$400/week typical). */
export function computeRent(
  amountCents: Cents,
  cadence: RentCadence
): { amountCents: Cents; cadence: RentCadence } {
  return { amountCents, cadence };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmt(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const v = Math.abs(cents);
  return `${sign}$${Math.floor(v / 100).toLocaleString()}.${String(v % 100).padStart(2, "0")}`;
}
