/**
 * test/fixes.test.js — Tests for the 5 correctness/misleading-behaviour fixes.
 *
 * Fix 1: showStopDetails connected to UI / /api/stop/:name ambiguity resolution
 * Fix 2: "nearby" label replaced by "popularStops" (accurate: busiest by bus count)
 * Fix 3: Request logging redacts stop names and path parameters
 * Fix 4: Stale-request race — covered by production lifecycle tests in navigation.test.js
 * Fix 5: reverseRecorded semantics — only means "within 2 changes", not full network
 *
 * API tests (Fix 1 no-result, Fix 2 field, Fix 5 field) also live in api.test.js
 * and dispatch through the actual Express app in-process, without loopback.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Fix 3 — safeRouteLabel: stop names and bus numbers must not appear in logs
// ---------------------------------------------------------------------------
describe("Fix 3 — safeRouteLabel redacts path parameters", () => {
  // Import after server module loads (data loading is a side effect)
  const { safeRouteLabel } = require("../backend/index.js");

  it("redacts stop name from /api/stop/:name", () => {
    const label = safeRouteLabel("GET", "/api/stop/Lalbagh");
    assert.ok(
      !label.includes("Lalbagh"),
      `Label must not contain the stop name, got: "${label}"`,
    );
    assert.equal(label, "GET /api/stop/:name");
  });

  it("redacts bus number from /api/bus/:number", () => {
    const label = safeRouteLabel("GET", "/api/bus/45A");
    assert.ok(
      !label.includes("45A"),
      `Label must not contain the bus number, got: "${label}"`,
    );
    assert.equal(label, "GET /api/bus/:number");
  });

  it("returns safe label for /api/plan", () => {
    assert.equal(safeRouteLabel("GET", "/api/plan"), "GET /api/plan");
  });

  it("returns safe label for /api/stops", () => {
    assert.equal(safeRouteLabel("GET", "/api/stops"), "GET /api/stops");
  });

  it("returns safe label for /api/health", () => {
    assert.equal(safeRouteLabel("GET", "/api/health"), "GET /api/health");
  });

  it("returns safe label for /api/buses", () => {
    assert.equal(safeRouteLabel("GET", "/api/buses"), "GET /api/buses");
  });

  it("returns /static for static file requests (never the filename)", () => {
    const label = safeRouteLabel("GET", "/favicon.svg");
    assert.ok(
      !label.includes("favicon.svg"),
      `Label must not contain filename, got: "${label}"`,
    );
    assert.equal(label, "GET /static");
  });

  it("never leaks a stop name even for deeply nested stop paths", () => {
    const label = safeRouteLabel("GET", "/api/stop/Some%20Very%20Long%20Stop%20Name");
    assert.ok(!label.includes("Some"), `Label must not leak URL content, got: "${label}"`);
    assert.equal(label, "GET /api/stop/:name");
  });

  it("preserves the HTTP method in the label", () => {
    const label = safeRouteLabel("POST", "/api/stop/Lalbagh");
    assert.ok(label.startsWith("POST"), `Label should start with method, got: "${label}"`);
  });
});

// ---------------------------------------------------------------------------
// Fix 1 — /api/stop/:name ambiguity resolution via planner.resolve()
// ---------------------------------------------------------------------------
describe("Fix 1 — planner.resolve() used for /api/stop/:name", () => {
  const { planner } = require("../backend/index.js");

  it("resolve() returns exact canonical stop without correction flag", () => {
    const r = planner.resolve("Lalbagh");
    assert.equal(r.stop, "Lalbagh");
    assert.equal(r.corrected, false);
  });

  it("resolve() is case-insensitive (alias / lowercase)", () => {
    const r = planner.resolve("state bank");
    assert.ok(r.stop !== null, "Should resolve case-insensitively");
    assert.equal(r.stop, "State Bank");
  });

  it("resolve() returns null stop for a name that cannot be matched", () => {
    const r = planner.resolve("zzz_nonexistent_stop_xyz");
    assert.equal(r.stop, null);
    assert.ok(Array.isArray(r.suggestions), "Should return suggestions array");
  });

  it("resolve() does not silently pick an arbitrary stop for unresolvable names", () => {
    const r = planner.resolve("zzz_nonexistent_stop_xyz");
    // The old code returned search(name, 1)[0] which could pick a random stop.
    // The new code returns null; the API then returns 404 with suggestions.
    assert.equal(r.stop, null);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — "popularStops" field: busiest stops, NOT geographically nearby
// ---------------------------------------------------------------------------
describe("Fix 2 — planner.busiestStops() returns a usable list", () => {
  const { planner } = require("../backend/index.js");

  it("busiestStops() returns a non-empty array of strings", () => {
    const stops = planner.busiestStops();
    assert.ok(Array.isArray(stops), "busiestStops should return an array");
    assert.ok(stops.length > 0, "busiestStops should return at least one stop");
    for (const s of stops) {
      assert.equal(typeof s, "string", `Each entry should be a string, got: ${typeof s}`);
    }
  });

  it("busiestStops() respects the count argument", () => {
    const stops3 = planner.busiestStops(3);
    assert.ok(stops3.length <= 3, "Should return at most 3 stops when asked for 3");
  });

  it("busiest stops are known canonical stop names (not invented)", () => {
    const stops = planner.busiestStops(5);
    for (const s of stops) {
      // Each returned stop should itself resolve cleanly
      const resolved = planner.resolve(s);
      assert.equal(
        resolved.stop,
        s,
        `Busiest stop "${s}" should resolve as a canonical name`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — reverseRecorded semantics via planner.plan()
// ---------------------------------------------------------------------------
describe("Fix 5 — reverseRecorded: only means 'within 2 changes', not full network", () => {
  const { planner } = require("../backend/index.js");

  // State Bank → Kunjathbail has results (confirmed above); reverse has none.
  it("plan(A,B) returns results when route exists in forward direction", () => {
    const results = planner.plan("State Bank", "Kunjathbail");
    assert.ok(results.length > 0, "Should find a route from State Bank to Kunjathbail");
  });

  it("plan(B,A) returns empty when only forward direction is recorded", () => {
    const results = planner.plan("Kunjathbail", "State Bank");
    assert.equal(
      results.length,
      0,
      "Reverse direction should return empty (not fabricated)",
    );
  });

  it("plan() returning [] does not mean no connection exists in the full network", () => {
    // This test documents the semantic guarantee. An empty result from plan(A,B)
    // means no route was found within the planner's search limit (≤2 changes),
    // not that no route exists in the complete timetabled network.
    const results = planner.plan("Bajpe", "Surathkal");
    // Even if this returns 0 today, the value [] carries no totality guarantee.
    // The API sets reverseRecorded to inform the UI which direction IS recorded.
    assert.ok(Array.isArray(results), "plan() must always return an array");
  });

  // Surathkal → Bajpe has results, confirming direction matters.
  it("plan(B,A) finds results when only the reverse direction is recorded", () => {
    const results = planner.plan("Surathkal", "Bajpe");
    assert.ok(
      results.length > 0,
      "Should find a route from Surathkal to Bajpe in the recorded direction",
    );
  });

  it("empty plan result + reverse plan result gives information for reverseRecorded flag", () => {
    // Simulate what the API does: plan(A,B) empty → check plan(B,A)
    const fwd = planner.plan("Kunjathbail", "State Bank");
    const rev = planner.plan("State Bank", "Kunjathbail");
    const reverseRecorded = rev.length > 0;
    assert.equal(fwd.length, 0, "forward should be empty");
    assert.ok(reverseRecorded, "reverseRecorded should be true when reverse finds results");
  });
});

// ---------------------------------------------------------------------------

