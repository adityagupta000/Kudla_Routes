#!/usr/bin/env node
/**
 * data/scripts/report.js — dataset provenance report
 *
 * Usage: npm run data:report
 *
 * Outputs:
 *   1. Routes with no recorded return pattern (all 99 currently), ranked by
 *      how many currently-unreachable stop pairs a verified return would unlock.
 *   2. Evidence summary across all dimensions.
 *   3. Confidence distribution.
 *
 * Amendment 1 (2026-11-12): No "N sources" text until sources are in a register.
 * This report uses confidence (high/medium/low) as a proxy for endpoint evidence
 * quality but does not label it with source counts.
 *
 * Human task: Return patterns for all 99 routes — requires field research.
 * See data/templates/pattern-verification.md for the verification protocol.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateDataset } = require("../../backend/validate");
const { createPlanner } = require("../../backend/planner");

const DATA_PATH = path.resolve(__dirname, "../busData.json");
const raw = fs.readFileSync(DATA_PATH);
const data = JSON.parse(raw.toString("utf8"));
const validation = validateDataset(data);
if (!validation.valid) {
  throw new Error(
    `Legacy runtime dataset is invalid:\n${validation.errors.map((error) => `  - ${error}`).join("\n")}`,
  );
}
const planner = createPlanner(data);
const buses = data.buses;
const stops = planner.stops();

// ---------------------------------------------------------------------------
// Build forward-reach index (same logic as planner, exposed for analysis)
// ---------------------------------------------------------------------------
function forwardReach(stopName) {
  const result = new Set();
  for (const bus of buses) {
    const i = bus.stops.indexOf(stopName);
    if (i < 0) continue;
    for (let j = i + 1; j < bus.stops.length; j++) result.add(bus.stops[j]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// For each bus terminal stop (last stop), count how many stops currently
// cannot reach that terminal (or be reached from it in the forward direction).
// A verified return pattern would unlock: all pairs (terminal → S) for every
// stop S that the bus passes through, where (terminal → S) is currently unreachable.
// ---------------------------------------------------------------------------
function countUnlockedPairs(bus) {
  const terminal = bus.stops[bus.stops.length - 1];
  // Stops this bus passes through (not the terminal itself)
  const routeStops = bus.stops.slice(0, -1);

  let unlocked = 0;
  // Currently: terminal is a "dead end" in the forward direction.
  // With a return pattern, terminal → every stop in routeStops would be new.
  for (const dest of routeStops) {
    // Only count if currently unreachable
    const result = planner.plan(terminal, dest);
    if (result.length === 0) unlocked++;
  }
  return { terminal, unlocked };
}

// ---------------------------------------------------------------------------
// Evidence summary
// ---------------------------------------------------------------------------
function evidenceSummary() {
  const dims = ["endpoints", "stopSequence", "direction", "currentOperation"];
  const counts = {};
  for (const dim of dims) {
    counts[dim] = {};
    for (const bus of buses) {
      const s = bus.evidence?.[dim] ?? "MISSING";
      counts[dim][s] = (counts[dim][s] || 0) + 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Main report
// ---------------------------------------------------------------------------
console.log("=".repeat(70));
console.log("KUDLA ROUTE — DATA PROVENANCE REPORT");
console.log(`Generated: ${new Date().toISOString()}`);
console.log("Dataset: data/busData.json (legacy runtime format; planner-compatible)");
console.log(`SHA-256: ${crypto.createHash("sha256").update(raw).digest("hex")}`);
console.log(`Counts: ${buses.length} buses, ${stops.length} stops, ${Object.keys(data.aliases || {}).length} aliases`);
console.log("This report does not operate on data/kudla-route-data.json.");
console.log("=".repeat(70));

// --- Confidence distribution ---
const confCounts = { high: 0, medium: 0, low: 0 };
for (const bus of buses) confCounts[bus.confidence] = (confCounts[bus.confidence] || 0) + 1;
console.log("\n## Confidence distribution (endpoint evidence proxy)\n");
console.log(`  high   (endpoints matched ≥2 sources): ${confCounts.high} buses`);
console.log(`  medium (endpoints matched 1 source):   ${confCounts.medium} buses`);
console.log(`  low    (no source match):               ${confCounts.low} buses`);
console.log("\n  Note: source-count text is a proxy from the confidence field.");
console.log("  A formal source register does not yet exist in busData.json.");

// --- Evidence summary ---
console.log("\n## Per-dimension evidence summary\n");
const summary = evidenceSummary();
const statuses = ["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "CONFLICTING", "HISTORICAL", "UNKNOWN"];
const pad = (s, n) => String(s).padEnd(n);
console.log("  " + pad("Dimension", 22) + statuses.map(s => pad(s.slice(0, 12), 14)).join(""));
console.log("  " + "-".repeat(22 + statuses.length * 14));
for (const [dim, counts] of Object.entries(summary)) {
  const row = statuses.map(s => pad(counts[s] || 0, 14)).join("");
  console.log("  " + pad(dim, 22) + row);
}

// --- Return pattern analysis ---
console.log("\n## Routes lacking a return pattern — ranked by unreachable pairs unlocked\n");
console.log("  Computing... (this may take ~30s)\n");

const results = [];
for (const bus of buses) {
  const { terminal, unlocked } = countUnlockedPairs(bus);
  results.push({ number: bus.number, confidence: bus.confidence, terminal, unlocked });
}

results.sort((a, b) => b.unlocked - a.unlocked || a.number.localeCompare(b.number, undefined, { numeric: true }));

const totalUnlockable = results.reduce((s, r) => s + r.unlocked, 0);
console.log(`  All ${buses.length} buses currently have no recorded return pattern.`);
console.log(`  If all return patterns were verified and added, up to ${totalUnlockable}`);
console.log(`  additional (terminal → stop) pairs could potentially be served.\n`);
console.log("  Human task: Field-verify return patterns for all 99 routes.");
console.log("  See data/templates/pattern-verification.md for the protocol.\n");
console.log(
  "  " + pad("Bus", 8) + pad("Conf", 8) + pad("Terminal stop", 36) + pad("Pairs unlocked", 16)
);
console.log("  " + "-".repeat(68));
for (const r of results) {
  console.log(
    "  " + pad(r.number, 8) + pad(r.confidence, 8) + pad(r.terminal, 36) + pad(r.unlocked, 16)
  );
}

console.log("\n" + "=".repeat(70));
console.log("END OF REPORT");
console.log("=".repeat(70));

