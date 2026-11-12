#!/usr/bin/env node
/**
 * scripts/smoke.js — local smoke test against a running server.
 *
 * Usage: node scripts/smoke.js [base-url]
 *   Default base URL: http://localhost:3000
 *
 * Tests: health, autocomplete, plan, bus lookup, stop detail.
 * This is a LOCAL REHEARSAL ONLY — not a production test.
 * Run after `npm start` to verify the server is functioning correctly.
 *
 * WP7: Added as a pre-deployment sanity check.
 */
"use strict";

const BASE = process.argv[2] || "http://localhost:3000";
let passed = 0;
let failed = 0;

async function check(label, url, assert) {
  try {
    const res = await fetch(url);
    const body = await res.json();
    const ok = assert(res.status, body);
    if (ok) {
      console.log(`  ✓  ${label}`);
      passed++;
    } else {
      console.error(`  ✗  ${label}`);
      console.error(`     URL: ${url}`);
      console.error(`     Status: ${res.status}`);
      console.error(`     Body: ${JSON.stringify(body).slice(0, 200)}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ✗  ${label} — ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log(`Smoke test against ${BASE}\n`);

  await check("GET /api/health → ok", `${BASE}/api/health`,
    (s, b) => s === 200 && b.status === "ok" && typeof b.buses === "number" && b.dataVersion);

  await check("GET /api/stops?q=state → results", `${BASE}/api/stops?q=state`,
    (s, b) => s === 200 && Array.isArray(b) && b.length > 0 && b[0].name);

  await check("GET /api/plan (direct route)", `${BASE}/api/plan?from=State+Bank&to=Kunjathbail`,
    (s, b) => s === 200 && Array.isArray(b.journeys) && b.journeys.length > 0);

  await check("GET /api/plan (no-result has reverseRecorded)", `${BASE}/api/plan?from=Kunjathbail&to=State+Bank`,
    (s, b) => s === 200 && Array.isArray(b.journeys) && typeof b.reverseRecorded === "boolean");

  await check("GET /api/plan (typo correction)", `${BASE}/api/plan?from=lalbagh&to=kunjathbail`,
    (s, b) => s === 200 && typeof b.from === "string");

  await check("GET /api/buses → array", `${BASE}/api/buses`,
    (s, b) => s === 200 && Array.isArray(b) && b.length > 0 && b[0].number && b[0].evidence);

  await check("GET /api/bus/1 → bus 1", `${BASE}/api/bus/1`,
    (s, b) => s === 200 && b.number === "1" && b.evidence && !b.confidence);

  await check("GET /api/bus/999 → 404", `${BASE}/api/bus/999`,
    (s) => s === 404);

  await check("GET /api/stop/Lalbagh → stop detail", `${BASE}/api/stop/Lalbagh`,
    (s, b) => s === 200 && b.name && Array.isArray(b.buses) && b.note);

  await check("GET /api/plan missing params → 400", `${BASE}/api/plan?from=Lalbagh`,
    (s) => s === 400);

  await check("GET /api/plan same stop → 400", `${BASE}/api/plan?from=Lalbagh&to=Lalbagh`,
    (s) => s === 400);

  await check("GET / → HTML frontend", `${BASE}/`,
    (s) => s === 200);

  console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
})();

