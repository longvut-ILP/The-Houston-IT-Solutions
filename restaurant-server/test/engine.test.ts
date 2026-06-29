import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBps, lineTotalCents, computeOrderTotals } from "../src/lib/orderEngine";

const cfg = { taxPctBps: 825, ccFeePctBps: 290, ccFeeFixedCents: 30 };

test("applyBps rounds to the nearest cent", () => {
  assert.equal(applyBps(1345, 825), 111); // 110.9625 -> 111
  assert.equal(applyBps(850, 825), 70); // 70.125 -> 70
});

test("lineTotalCents includes per-unit modifiers", () => {
  assert.equal(lineTotalCents({ unitPriceCents: 475, quantity: 2 }), 950);
  assert.equal(lineTotalCents({ unitPriceCents: 475, quantity: 2, modifierDeltasCents: [50] }), 1050);
});

test("order totals: card with tip", () => {
  const t = computeOrderTotals(
    [
      { unitPriceCents: 475, quantity: 2 },
      { unitPriceCents: 395, quantity: 1 },
    ],
    cfg,
    { tipCents: 200, method: "CARD" }
  );
  assert.equal(t.subtotalCents, 1345);
  assert.equal(t.taxCents, 111);
  assert.equal(t.totalCents, 1656);
  assert.equal(t.cardFeeCents, 78); // round(1656*0.029)=48 + 30
});

test("order totals: cash has no card fee", () => {
  const t = computeOrderTotals([{ unitPriceCents: 295, quantity: 1 }], cfg, { method: "CASH" });
  assert.equal(t.subtotalCents, 295);
  assert.equal(t.taxCents, 24); // 24.3375 -> 24
  assert.equal(t.totalCents, 319);
  assert.equal(t.cardFeeCents, 0);
});
