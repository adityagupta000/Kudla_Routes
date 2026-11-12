// Guards the bus data against schema violations and consistency rules.
// WP2: Tests now use the shared validateDataset() from backend/validate.js,
// so the same rules apply at startup and in CI.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const data = require("../data/busData.json");
const { normalize } = require("../backend/planner");
const { validateDataset, VALID_EVIDENCE_STATUSES, EVIDENCE_DIMENSIONS } = require("../backend/validate");

const allStops = new Set(data.buses.flatMap((bus) => bus.stops));

// ---------------------------------------------------------------------------
// Shared validator (WP2) — the same function used at startup
// ---------------------------------------------------------------------------

test("validateDataset() passes on the current busData.json", () => {
  const result = validateDataset(data);
  assert.ok(
    result.valid,
    `validateDataset() found ${result.errors.length} error(s):\n` +
      result.errors.map((e) => `  - ${e}`).join("\n"),
  );
});

// ---------------------------------------------------------------------------
// Individual invariants (kept as separate tests for fast, targeted failures)
// ---------------------------------------------------------------------------

test("every bus has a unique id and number", () => {
  assert.equal(new Set(data.buses.map((b) => b.id)).size, data.buses.length);
  assert.equal(
    new Set(data.buses.map((b) => b.number)).size,
    data.buses.length,
  );
});

test("every route has at least two stops and no stop twice", () => {
  for (const bus of data.buses) {
    assert.ok(
      bus.stops.length >= 2,
      `bus ${bus.number} has fewer than 2 stops`,
    );
    assert.equal(
      new Set(bus.stops).size,
      bus.stops.length,
      `bus ${bus.number} repeats a stop`,
    );
  }
});

test("no stray whitespace or trailing punctuation in names", () => {
  for (const stop of allStops) {
    assert.equal(
      stop,
      stop.trim().replace(/\s+/g, " "),
      `"${stop}" has odd spacing`,
    );
    assert.ok(!/[.,;]$/.test(stop), `"${stop}" ends with punctuation`);
  }
});

test("no two stops are the same name spelled differently (this would break transfers)", () => {
  const seen = new Map();
  for (const stop of allStops) {
    const key = normalize(stop);
    assert.ok(
      !seen.has(key),
      `"${stop}" and "${seen.get(key)}" are the same stop`,
    );
    seen.set(key, stop);
  }
});

test("confidence is high, medium or low", () => {
  for (const bus of data.buses)
    assert.ok(["high", "medium", "low"].includes(bus.confidence), bus.number);
});

test("every alias points at a real stop", () => {
  for (const [alias, stop] of Object.entries(data.aliases)) {
    assert.ok(
      allStops.has(stop),
      `alias "${alias}" points at unknown stop "${stop}"`,
    );
  }
});

// WP2: Per-dimension evidence validation (uses shared constants)
test("every bus has an evidence object with valid status values", () => {
  for (const bus of data.buses) {
    assert.ok(
      bus.evidence && typeof bus.evidence === "object",
      `bus ${bus.number} missing evidence object`,
    );
    for (const dim of EVIDENCE_DIMENSIONS) {
      assert.ok(
        VALID_EVIDENCE_STATUSES.includes(bus.evidence[dim]),
        `bus ${bus.number} evidence.${dim} is "${bus.evidence[dim]}" — must be one of ${VALID_EVIDENCE_STATUSES.join(", ")}`,
      );
    }
  }
});

test("high-confidence buses have PARTIALLY_VERIFIED endpoints (not UNVERIFIED)", () => {
  for (const bus of data.buses.filter((b) => b.confidence === "high")) {
    assert.notEqual(
      bus.evidence.endpoints,
      "UNVERIFIED",
      `bus ${bus.number} is high confidence but has UNVERIFIED endpoints`,
    );
  }
});

test("no bus claims VERIFIED stop sequence (none have been independently confirmed)", () => {
  for (const bus of data.buses) {
    assert.notEqual(
      bus.evidence.stopSequence,
      "VERIFIED",
      `bus ${bus.number} claims VERIFIED stop sequence — this is not supported by any source`,
    );
    assert.notEqual(
      bus.evidence.direction,
      "VERIFIED",
      `bus ${bus.number} claims VERIFIED direction — this is not supported by any source`,
    );
  }
});

// ---------------------------------------------------------------------------
// WP2: Evidence parity — confidence vs evidence consistency
//
// Amendment 1: Keep busData.json as runtime unless v2 carries equivalent
// endpoint evidence. No "N sources" text until sources are in a register.
//
// What we CAN assert: confidence and evidence.endpoints must be consistent.
//   high   → PARTIALLY_VERIFIED  (matched 2 sources — stored as confidence)
//   medium → PARTIALLY_VERIFIED  (matched 1 source — stored as confidence)
//   low    → UNVERIFIED          (no source match)
//
// The 1-source vs 2-source distinction is encoded in `confidence`, not in
// `evidence.endpoints` (both high and medium produce PARTIALLY_VERIFIED).
// This is intentional: the source register does not exist in busData.json,
// so we cannot surface a source count. See docs/audit/gap-closure-2.md §F3.
// ---------------------------------------------------------------------------

test("evidence parity: low-confidence buses have UNVERIFIED endpoints", () => {
  // Low confidence = no source match → endpoints must be UNVERIFIED (or UNKNOWN)
  for (const bus of data.buses.filter((b) => b.confidence === "low")) {
    assert.ok(
      ["UNVERIFIED", "UNKNOWN"].includes(bus.evidence.endpoints),
      `bus ${bus.number} is low confidence but evidence.endpoints is "${bus.evidence.endpoints}" — expected UNVERIFIED or UNKNOWN`,
    );
  }
});

test("evidence parity: medium/high buses have PARTIALLY_VERIFIED endpoints", () => {
  // Medium and high = at least 1 source match → endpoints must be PARTIALLY_VERIFIED
  for (const bus of data.buses.filter((b) => ["high", "medium"].includes(b.confidence))) {
    assert.strictEqual(
      bus.evidence.endpoints,
      "PARTIALLY_VERIFIED",
      `bus ${bus.number} is ${bus.confidence} confidence but evidence.endpoints is "${bus.evidence.endpoints}" — expected PARTIALLY_VERIFIED`,
    );
  }
});

test("evidence parity: no bus claims more evidence than confidence supports", () => {
  // No bus with low confidence should claim PARTIALLY_VERIFIED endpoints.
  // No bus should claim VERIFIED for any dimension (no source register exists).
  for (const bus of data.buses) {
    for (const dim of EVIDENCE_DIMENSIONS) {
      assert.notEqual(
        bus.evidence[dim],
        "VERIFIED",
        `bus ${bus.number} evidence.${dim} claims VERIFIED — no source register exists in busData.json`,
      );
    }
  }
});

const copyRuntimeData = () => structuredClone(data);

function assertInvalid(candidate, expectedMessage) {
  const result = validateDataset(candidate);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), expectedMessage);
}

test("validateDataset rejects invalid top-level structure and update dates", () => {
  assertInvalid(null, /data must be a plain object/);
  assertInvalid({ buses: [], aliases: {}, updated: "2026-02-31" }, /data\.updated/);

  const missingAliases = copyRuntimeData();
  delete missingAliases.aliases;
  assertInvalid(missingAliases, /data\.aliases must be a plain object/);

  const missingBuses = copyRuntimeData();
  missingBuses.buses = "not an array";
  assertInvalid(missingBuses, /data\.buses must be a non-empty array/);
});

test("validateDataset rejects malformed buses and duplicate IDs or route numbers", () => {
  const malformedBus = copyRuntimeData();
  malformedBus.buses[0] = null;
  assertInvalid(malformedBus, /buses\[0\] must be a plain object/);

  const duplicateId = copyRuntimeData();
  duplicateId.buses[1].id = duplicateId.buses[0].id;
  assertInvalid(duplicateId, /id .*duplicates buses/);

  const duplicateNumber = copyRuntimeData();
  duplicateNumber.buses[1].number = duplicateNumber.buses[0].number.toLowerCase();
  assertInvalid(duplicateNumber, /duplicates buses\[0\] after normalization/);

  const invalidId = copyRuntimeData();
  invalidId.buses[0].id = "1";
  assertInvalid(invalidId, /id must be a positive safe integer/);
});

test("validateDataset rejects malformed routes and normalized stop-name collisions", () => {
  const tooShort = copyRuntimeData();
  tooShort.buses[0].stops = ["Only one"];
  assertInvalid(tooShort, /stops must be an array with at least 2 entries/);

  const duplicateStop = copyRuntimeData();
  duplicateStop.buses[0].stops[1] = duplicateStop.buses[0].stops[0];
  assertInvalid(duplicateStop, /appears more than once/);

  const normalizedCollision = copyRuntimeData();
  normalizedCollision.buses[0].stops[1] = "state-bank";
  assertInvalid(normalizedCollision, /collide after normalization/);
});

test("validateDataset checks confidence, evidence status, and unsupported VERIFIED claims", () => {
  const invalidConfidence = copyRuntimeData();
  invalidConfidence.buses[0].confidence = "certain";
  assertInvalid(invalidConfidence, /confidence must be one of/);

  const invalidEvidence = copyRuntimeData();
  invalidEvidence.buses[0].evidence.stopSequence = "OBSERVED";
  assertInvalid(invalidEvidence, /evidence\.stopSequence must be one of/);

  const unsupportedVerified = copyRuntimeData();
  unsupportedVerified.buses[0].evidence.direction = "VERIFIED";
  assertInvalid(unsupportedVerified, /claims VERIFIED.*no per-claim source reference/);

  const inconsistentEndpoints = copyRuntimeData();
  inconsistentEndpoints.buses[0].evidence.endpoints = "UNKNOWN";
  assertInvalid(inconsistentEndpoints, /endpoint confidence conflicts/);
});

test("validateDataset checks alias targets and normalized alias collisions", () => {
  const unknownTarget = copyRuntimeData();
  unknownTarget.aliases.notAStop = "Unknown Stop";
  assertInvalid(unknownTarget, /points to unknown stop/);

  const canonicalCollision = copyRuntimeData();
  canonicalCollision.aliases["State Bank"] = "Lalbagh";
  assertInvalid(canonicalCollision, /collides with canonical stop/);
});

test("startup exits with useful validation errors when runtime data is invalid", () => {
  const script = [
    'const Module = require("node:module");',
    'const path = require("node:path");',
    'const original = Module._extensions[".json"];',
    'const invalidPath = path.resolve("data/busData.json");',
    'Module._extensions[".json"] = (module, filename) => {',
    '  if (path.resolve(filename) === invalidPath) {',
    '    module.exports = { updated: "bad-date", buses: [null], aliases: {} };',
    '    return;',
    '  }',
    '  original(module, filename);',
    '};',
    'require("./backend/index.js");',
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Fatal: bus data failed validation/);
  assert.match(result.stderr, /data\.updated/);
  assert.match(result.stderr, /buses\[0\] must be a plain object/);
});
