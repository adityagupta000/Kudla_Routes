/**
 * completeness.test.js — planner completeness oracle
 *
 * An independent bounded reachability check written against raw busData.json
 * verifies that plan() finds at least one route for every stop pair reachable
 * within 2 changes (3 legs). This does not assert that every alternative path
 * is enumerated; results are capped at five and alternatives are planner-ranked.
 *
 * Amendment 2 decision (2026-11-12):
 *   The completeness BFS is bounded to 2 changes (3 legs). Pairs that require
 *   3 or more changes are NOT required to appear in plan() output.
 *   See the "3+ changes" test below for the count and deferral rationale.
 *
 * WP1 fix verified here: the hasPointlessChange rewrite unblocked 27 pairs
 * that were previously reachable by BFS but returned [] from plan().
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPlanner } = require("../backend/planner");
const data = require("../data/busData.json");

const planner = createPlanner(data);
const buses = data.buses;

// ---------------------------------------------------------------------------
// Independent BFS oracle — pure function, no dependency on planner internals
// ---------------------------------------------------------------------------

/**
 * Returns all stops reachable from `from` within maxChanges changes using a
 * state-queue traversal of raw bus sequences. This deliberately does not use
 * planner reach caches or candidate-generation helpers.
 */
function reachableWithinChanges(from, maxChanges = 2) {
  const queue = [{ stop: from, bus: null, changes: 0 }];
  const visited = new Set();
  const reachable = new Set();

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor];
    for (const bus of buses) {
      const start = bus.stops.indexOf(state.stop);
      if (start < 0) continue;
      const changes = state.changes +
        (state.bus !== null && state.bus !== bus.number ? 1 : 0);
      if (changes > maxChanges) continue;

      for (let index = start + 1; index < bus.stops.length; index++) {
        const stop = bus.stops[index];
        reachable.add(stop);
        const key = `${stop}\0${bus.number}\0${changes}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ stop, bus: bus.number, changes });
        }
      }
    }
  }
  return reachable;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("completeness: plan() finds all BFS-reachable pairs (≤2 changes)", () => {

  it("the 27 pairs previously missed by hasPointlessChange are now found", () => {
    // These are the exact pairs that were BFS-reachable but returned [] before
    // the WP1 hasPointlessChange fix. They are listed explicitly as regression
    // guards: if any returns [], the fix has been reverted or broken.
    const fixtures = [
      ["Urva Stores",    "Chilimbi"],
      ["Kadri",          "Mallikatte"],
      ["Bikkarnakatta",  "Mallikatte"],
      ["Nanthur",        "Mallikatte"],
      ["Nagori",         "Pumpwell"],
      ["Padil",          "Bejai Museum"],
      ["Padil",          "Kadri Temple"],
      ["Garodi",         "Pumpwell"],
      ["Garodi",         "Nagori"],
      ["Akashavani",     "Mallikatte"],
      ["Akashavani",     "Kadri Market"],
      ["Kadri Market",   "Mallikatte"],
      ["Bejai",          "Mallikatte"],
      ["Bejai",          "Akashavani"],
      ["Bejai",          "Kadri Market"],
      ["KSRTC Bus Stand","Mallikatte"],
      ["KSRTC Bus Stand","Akashavani"],
      ["KSRTC Bus Stand","Kadri Market"],
      ["Bharat Mall",    "Mallikatte"],
      ["Bharat Mall",    "Akashavani"],
      ["Bharat Mall",    "Kadri Market"],
      ["Jeppu Market",   "Bolar"],
      ["Maroli",         "Mallikatte"],
      ["Maroli",         "Kadri"],
      ["Maroli",         "Bikkarnakatta"],
      ["Maroli",         "Nanthur"],
      ["Kadri Temple",   "Bejai Museum"],
    ];
    const reachableByStart = new Map(
      [...new Set(fixtures.map(([from]) => from))]
        .map((from) => [from, reachableWithinChanges(from, 2)]),
    );
    for (const [from, to] of fixtures) {
      assert.ok(
        reachableByStart.get(from).has(to) && planner.plan(from, to).length > 0,
        `plan("${from}", "${to}") should return ≥1 journey (WP1 fix regression)`,
      );
    }
  });

  it("plan() finds every pair the BFS oracle finds within 2 changes", function() {
    // This test checks ALL 34,410 ordered pairs. It runs the BFS oracle for
    // each and asserts plan() finds at least one result for every reachable pair.
    // Expected run time: ~5–8 s.
    const stops = planner.stops();
    const missed = [];
    for (const from of stops) {
      const reachable = reachableWithinChanges(from, 2);
      for (const to of stops) {
        if (from === to) continue;
        if (!reachable.has(to)) continue;
        if (planner.plan(from, to).length === 0) missed.push([from, to]);
      }
    }
    assert.strictEqual(
      missed.length,
      0,
      `plan() missed ${missed.length} BFS-reachable pair(s):\n` +
        missed.map(([f, t]) => `  ${f} → ${t}`).join("\n"),
    );
  });

});

describe("completeness: plan() output structural sanity after WP1", () => {

  it("no journey in the fixed pairs has 'cost' exposed in its fields", () => {
    const result = planner.plan("Urva Stores", "Chilimbi");
    assert.ok(result.length > 0, "must return at least one journey");
    for (const journey of result) {
      assert.ok(
        !("cost" in journey),
        "journey must not expose internal 'cost' field",
      );
      assert.ok(
        !("_cost" in journey),
        "journey must not expose internal '_cost' field",
      );
    }
  });

  it("Urva Stores → Chilimbi: first result has correct structure", () => {
    const [journey] = planner.plan("Urva Stores", "Chilimbi");
    assert.ok(journey, "expect at least one journey");
    assert.ok(typeof journey.changes === "number" && journey.changes >= 0);
    assert.ok(typeof journey.rides === "number" && journey.rides >= 1);
    assert.ok(typeof journey.rankingNote === "string");
    assert.ok(Array.isArray(journey.legs) && journey.legs.length >= 1);
    // Legs must join up
    for (let i = 0; i < journey.legs.length - 1; i++) {
      assert.strictEqual(
        journey.legs[i].to,
        journey.legs[i + 1].from,
        `leg ${i}.to must equal leg ${i + 1}.from`,
      );
    }
    assert.strictEqual(journey.legs[0].from, "Urva Stores");
    assert.strictEqual(journey.legs[journey.legs.length - 1].to, "Chilimbi");
  });

  it("plan() does not expose 'cost' on any result for any stop pair (sample)", () => {
    // Sample 50 random pairs from the first 10 stops to keep this fast
    const stops = planner.stops().slice(0, 10);
    for (const from of stops) {
      for (const to of stops) {
        if (from === to) continue;
        for (const journey of planner.plan(from, to)) {
          assert.ok(!("cost" in journey), `'cost' should not be on journey from ${from} to ${to}`);
        }
      }
    }
  });

});

describe("3+ changes: decision record", () => {

  it("records how many pairs need 3 changes and documents the deferral decision", function() {
    // This test does NOT assert that plan() finds 3-change pairs.
    // It records the count so the CI log captures it.
    //
    // Decision (2026-11-12, amendment 2): pairs needing exactly 3 changes are DEFERRED.
    // Measured count: 1,230 pairs (computed 2026-11-12 against busData.json with 99 buses).
    //
    // Rationale:
    //   • The planner has no verified return patterns. Many of these pairs are
    //     only reachable via 3 changes because the reverse direction is absent
    //     from the dataset. When verified return patterns are added (human task:
    //     field research, all 99 routes), re-evaluate: many will collapse to 1-change.
    //   • Adding 3-change search increases worst-case query time significantly
    //     and the dataset does not yet justify it.
    //   • Until then: plan() returns [] for these pairs and the UI says
    //     "No connection recorded between these stops."
    //
    // To revisit: when return patterns are added, run a fresh 3-change BFS count
    // and decide whether to extend the planner or accept the residual gap.
    const stops = planner.stops();
    let count3 = 0;
    for (const from of stops) {
      const within2 = reachableWithinChanges(from, 2);
      const within3 = reachableWithinChanges(from, 3);
      for (const to of stops) {
        if (from === to) continue;
        if (within2.has(to)) continue;   // already covered by plan()
        if (within3.has(to)) count3++;
      }
    }
    // Log so the CI record captures the actual number.
    console.log(`# Pairs needing exactly 3 changes (DEFERRED): ${count3}`);
    console.log(
      "# Decision: 3-change search DEFERRED until verified return patterns are added.",
    );
    // The count should be stable for a given dataset. It is not asserted to a
    // specific value because it will shrink as return patterns are verified.
    assert.ok(count3 >= 0 && Number.isFinite(count3), "count must be finite");
  });

});
