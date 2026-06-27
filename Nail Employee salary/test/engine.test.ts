import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBps,
  cardFee,
  computeW2Ticket,
  computeRenterPayout,
  computeFlsaWorkweek,
  poolTipsByHours,
  SalonConfig,
  TechConfig,
  Ticket,
} from "../src/lib/commissionEngine";

const CONFIG: SalonConfig = {
  ccFeePctBps: 290, // 2.9%
  ccFeeFixedCents: 30, // $0.30
  productCostPctBps: 1000, // 10%
  minWageCentsPerHour: 1600, // $16.00
  tipPoolingEnabled: false,
};

const W2_TECH: TechConfig = {
  id: "t1",
  name: "Mai",
  employmentType: "W2",
  serviceCommissionBps: 5000, // 50%
  retailCommissionBps: 1000, // 10%
};

const TICKET: Ticket = {
  serviceRevenueCents: 10000, // $100 service
  retailRevenueCents: 2000, // $20 retail
  ccTipCents: 2000, // $20 card tip
  cashTipCents: 0,
};

test("applyBps rounds to the nearest cent (half-up)", () => {
  assert.equal(applyBps(8941, 5000), 4471); // 4470.5 -> 4471
  assert.equal(applyBps(2000, 1000), 200);
  assert.equal(applyBps(0, 5000), 0);
});

test("cardFee = percent + fixed, and is 0 on non-positive amounts", () => {
  assert.equal(cardFee(10000, CONFIG), 59); // round(29) + 30
  assert.equal(cardFee(0, CONFIG), 0);
  assert.equal(cardFee(-5, CONFIG), 0);
});

test("computeW2Ticket runs the PRD sequence in cents", () => {
  const b = computeW2Ticket(TICKET, W2_TECH, CONFIG);
  assert.equal(b.ccFeeOnServiceCents, 59);
  assert.equal(b.productCostCents, 1000);
  assert.equal(b.netServiceRevenueCents, 8941);
  assert.equal(b.serviceCommissionCents, 4471);
  assert.equal(b.retailCommissionCents, 200);
  assert.equal(b.commissionWagesCents, 4671);
  assert.equal(b.techTakeHomeCents, 6671); // 4671 + 2000 tip
});

test("computeRenterPayout keeps gross service + tip, nets the card fee", () => {
  const p = computeRenterPayout(TICKET, CONFIG);
  assert.equal(p.cardFeeCents, 378); // round(12000*2.9%)=348 + 30
  assert.equal(p.instantPayoutCents, 11622); // 12000 - 378
  assert.equal(p.salonRetailRevenueCents, 2000); // retail stays with salon
  assert.equal(p.cashTipCents, 0);
});

test("FLSA: commissions below the floor are topped up to minimum wage", () => {
  const r = computeFlsaWorkweek({
    commissionWagesCents: 40000,
    hoursWorked: 45,
    minWageCentsPerHour: 1600,
  });
  assert.equal(r.minWageFloorCents, 72000);
  assert.equal(r.minWageTopUpCents, 32000);
  assert.equal(r.regularRateCentsPerHour, 1600);
  assert.equal(r.overtimePremiumCents, 4000); // 0.5 * 1600 * 5
  assert.equal(r.grossPayCents, 76000); // 40*16 + 5*24
});

test("FLSA: overtime uses the commissioned regular rate, not base wage", () => {
  const r = computeFlsaWorkweek({
    commissionWagesCents: 100000,
    hoursWorked: 45,
    minWageCentsPerHour: 1600,
  });
  assert.equal(r.minWageTopUpCents, 0);
  assert.equal(r.regularRateCentsPerHour, 2222); // round(100000/45)
  assert.equal(r.overtimePremiumCents, 5555); // round(0.5 * 2222 * 5)
  assert.equal(r.grossPayCents, 105555);
});

test("FLSA: no overtime at or under 40 hours", () => {
  const r = computeFlsaWorkweek({
    commissionWagesCents: 90000,
    hoursWorked: 40,
    minWageCentsPerHour: 1600,
  });
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.overtimePremiumCents, 0);
  assert.equal(r.grossPayCents, 90000);
});

test("tip pool: even split by hours", () => {
  const shares = poolTipsByHours(10000, [
    { techId: "a", hours: 6 },
    { techId: "b", hours: 4 },
  ]);
  const byId = Object.fromEntries(shares.map((s) => [s.techId, s.shareCents]));
  assert.equal(byId.a, 6000);
  assert.equal(byId.b, 4000);
});

test("tip pool: largest-remainder makes shares sum exactly to the pool", () => {
  const total = 10001;
  const shares = poolTipsByHours(total, [
    { techId: "a", hours: 1 },
    { techId: "b", hours: 2 },
  ]);
  const sum = shares.reduce((s, x) => s + x.shareCents, 0);
  assert.equal(sum, total); // no lost or invented cents
  const byId = Object.fromEntries(shares.map((s) => [s.techId, s.shareCents]));
  assert.equal(byId.a, 3334); // gets the leftover cent (higher remainder)
  assert.equal(byId.b, 6667);
});

test("tip pool: zero hours yields zero shares, never divides by zero", () => {
  const shares = poolTipsByHours(5000, [{ techId: "a", hours: 0 }]);
  assert.equal(shares[0].shareCents, 0);
});
