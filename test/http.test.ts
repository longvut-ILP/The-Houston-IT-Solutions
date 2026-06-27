import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Must be set before any code reads it (jwt reads JWT_SECRET lazily).
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

import { createApp } from "../src/http/app";
import { signToken } from "../src/auth/jwt";

// These tests never touch the database: /health is public, auth is rejected
// before any query, and validation runs before the tenancy DB lookups.
const SALON = "00000000-0000-0000-0000-000000000001";
const OWNER = signToken({ staffId: "00000000-0000-0000-0000-0000000000f0", salonId: SALON, role: "OWNER" });
const authH = { authorization: `Bearer ${OWNER}`, "content-type": "application/json" };

let server: Server;
let base: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

test("GET /health is public and returns ok", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("protected route without a token returns 401", async () => {
  const res = await fetch(`${base}/auth/me`);
  assert.equal(res.status, 401);
});

test("POST /auth/login rejects a malformed body (400)", async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(res.status, 400);
});

test("POST /checkout (authed) rejects empty line items (400)", async () => {
  const res = await fetch(`${base}/checkout`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ techId: "00000000-0000-0000-0000-0000000000a1", lineItems: [] }),
  });
  assert.equal(res.status, 400);
});

test("POST /checkout (authed) rejects a non-uuid techId (400)", async () => {
  const res = await fetch(`${base}/checkout`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ techId: "nope", lineItems: [{ kind: "SERVICE", amountCents: 8000 }] }),
  });
  assert.equal(res.status, 400);
});

test("GET /tip-pool (authed owner) rejects a malformed date (400)", async () => {
  const res = await fetch(`${base}/tip-pool?salonId=${SALON}&date=06-2026`, { headers: authH });
  assert.equal(res.status, 400);
});

test("owner/admin route is forbidden for a TECH token (403)", async () => {
  const techToken = signToken({ staffId: "00000000-0000-0000-0000-0000000000a1", salonId: SALON, role: "TECH" });
  const res = await fetch(`${base}/tip-pool?salonId=${SALON}&date=2026-06-26`, {
    headers: { authorization: `Bearer ${techToken}` },
  });
  assert.equal(res.status, 403);
});

test("cross-salon access is denied (403)", async () => {
  const otherSalon = "11111111-1111-1111-1111-111111111111";
  const res = await fetch(`${base}/salons/${otherSalon}/settings`, { headers: authH });
  assert.equal(res.status, 403);
});
