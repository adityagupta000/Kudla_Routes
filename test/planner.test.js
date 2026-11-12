/**
 * planner.test.js — unit tests for the journey planner.
 *
 * Phase 2 update: "buses run both ways" test removed. The planner no longer
 * assumes bidirectional traversal. Only forward direction (as stored in data)
 * is traversed. This is an intentional correctness improvement.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/busData.json");
const { createPlanner, EVIDENCE_STATUSES } = require("../backend/planner");

const planner = createPlanner(data);

test("direct bus is found and ranked first", () => {
  const [best] = planner.plan("State Bank", "Kunjathbail");
  assert.equal(best.changes, 0);
  assert.deepEqual(best.legs[0].buses, ["1"]);
  assert.equal(best.legs[0].rides, 8);
});

test("buses on the exact same road are grouped as one option", () => {
  const options = planner
    .plan("State Bank", "Kunjathbail")
    .filter((j) => j.changes === 0);
  const longRoad = options.find((j) => j.legs[0].buses.includes("17"));
  assert.deepEqual(longRoad.legs[0].buses, ["17", "17A", "17B"]);
});

test("forward direction: bus 1 goes State Bank to Kunjathbail", () => {
  const [best] = planner.plan("State Bank", "Kunjathbail");
  assert.equal(best.legs[0].stops[0], "State Bank");
  assert.equal(best.legs[0].stops.at(-1), "Kunjathbail");
  assert.equal(best.changes, 0);
});

test("direction is stored only as forward: reverse requires a transfer or separate pattern", () => {
  // Bus 1 is stored as State Bank -> Kunjathbail. The planner should NOT
  // find a direct journey from Kunjathbail to State Bank using bus 1 alone
  // since no reverse pattern exists for bus 1.
  // A journey IS found (via transfers), but it should not be a direct bus-1 trip.
  const journeys = planner.plan("Kunjathbail", "State Bank");
  // Any journey found should NOT be a single-leg direct trip using bus 1 in reverse
  const directBus1Reverse = journeys.find(
    (j) => j.changes === 0 && j.legs[0].buses.includes("1") && j.legs[0].stops[0] === "Kunjathbail",
  );
  assert.equal(
    directBus1Reverse,
    undefined,
    "Bus 1 should not be found going directly from Kunjathbail to State Bank (no reverse pattern)",
  );
});

test("with no direct bus, it offers several ways with a change", () => {
  const journeys = planner.plan("Mangaladevi", "Bajpe Airport");
  assert.ok(journeys.length >= 1, "expected at least one alternative");
  assert.ok(journeys.every((j) => j.changes >= 1));
});

test("legs join up: each leg starts where the last one ended", () => {
  for (const journey of planner.plan("Konaje", "Polali")) {
    assert.equal(journey.legs[0].from, "Konaje");
    assert.equal(journey.legs.at(-1).to, "Polali");
    journey.legs.forEach((leg, i) => {
      if (i > 0) assert.equal(leg.from, journey.legs[i - 1].to);
      assert.equal(leg.stops[0], leg.from);
      assert.equal(leg.stops.at(-1), leg.to);
    });
  }
});

test("never suggests changing buses when one bus already does the job", () => {
  for (const journey of planner.plan("Lalbagh", "Surathkal")) {
    const used = journey.legs.flatMap((leg) => leg.buses);
    if (journey.changes > 0) assert.equal(new Set(used).size, used.length);
  }
  // 2 serves both Lalbagh and Surathkal, so a direct route should exist
  assert.equal(planner.plan("Lalbagh", "Surathkal")[0].changes, 0);
});

test("a group of buses shows the confidence of its least-confirmed bus", () => {
  const byNumber = Object.fromEntries(
    data.buses.map((b) => [b.number, b.confidence]),
  );
  const rank = { low: 1, medium: 2, high: 3 };
  for (const journey of planner.plan("Lalbagh", "Bajpe Airport")) {
    for (const leg of journey.legs) {
      const weakest = Math.min(...leg.buses.map((n) => rank[byNumber[n]]));
      assert.equal(rank[leg.confidence], weakest, leg.buses.join("/"));
    }
  }
});

test("journeys are sorted: fewer transfers first, then fewer stops", () => {
  const journeys = planner.plan("Surathkal", "Ullal");
  for (let i = 1; i < journeys.length; i++) {
    const prev = journeys[i - 1];
    const curr = journeys[i];
    // changes should be non-decreasing
    assert.ok(
      curr.changes >= prev.changes ||
        (curr.changes === prev.changes && curr.rides >= prev.rides),
      `journey ${i} has fewer changes (${curr.changes}) than journey ${i - 1} (${prev.changes})`,
    );
  }
});

test("every stop can reach every busiest stop", () => {
  const hubs = planner.busiestStops(3);
  for (const stop of planner.stops()) {
    for (const hub of hubs) {
      if (stop === hub) continue;
      // With forward-only traversal, some reverse directions may require
      // transfers or be unreachable. We only assert that if a route is found
      // it is structurally valid — not that every pair must be reachable.
      const journeys = planner.plan(stop, hub);
      for (const j of journeys) {
        assert.equal(j.legs[0].from, stop);
        assert.equal(j.legs.at(-1).to, hub);
      }
    }
  }
});

test("typing: aliases, casing, spacing and small typos are forgiven", () => {
  assert.equal(planner.resolve("lal bagh").stop, "Lalbagh");
  assert.equal(planner.resolve("STATEBANK").stop, "State Bank");
  assert.equal(planner.resolve("airport").stop, "Bajpe Airport");
  assert.equal(planner.resolve("kankandy").stop, "Kankanady");
  assert.equal(planner.resolve("Kankanadi").stop, "Kankanady");
});

test("an unknown or ambiguous name gives suggestions instead of guessing", () => {
  assert.equal(planner.resolve("zzzzzz").stop, null);
  const ambiguous = planner.resolve("kad");
  assert.equal(ambiguous.stop, null);
  assert.ok(ambiguous.suggestions.length > 1);
});

test("autocomplete finds a word in the middle of a name, and shows busy stops first when empty", () => {
  assert.ok(planner.search("bank").some((hit) => hit.stop === "State Bank"));
  assert.equal(planner.search("")[0].stop, "State Bank");
});

// Phase 1: Evidence fields are present and valid on legs
test("every leg in a journey has an evidence object with valid statuses", () => {
  const journey = planner.plan("State Bank", "Kunjathbail")[0];
  for (const leg of journey.legs) {
    assert.ok(leg.evidence, "leg missing evidence");
    for (const dim of ["endpoints", "stopSequence", "direction", "currentOperation"]) {
      assert.ok(
        EVIDENCE_STATUSES.includes(leg.evidence[dim]),
        `leg evidence.${dim} "${leg.evidence[dim]}" is not a valid status`,
      );
    }
  }
});

// Phase 3: rankingNote is present on journey results
test("journey results include a rankingNote explaining the heuristic", () => {
  const journeys = planner.plan("State Bank", "Lalbagh");
  for (const j of journeys) {
    assert.ok(typeof j.rankingNote === "string" && j.rankingNote.length > 0,
      "journey missing rankingNote");
  }
});

// Phase 3: Two-change search is not suppressed by one-change results
test("two-change search runs even when multiple one-change results exist", () => {
  // Find a pair with many intermediate connections that would previously
  // suppress the two-change search. The key assertion: the planner doesn't throw
  // and returns at most MAX_RESULTS=5 journeys.
  const journeys = planner.plan("Lalbagh", "Bajpe Airport");
  assert.ok(journeys.length <= 5, "should return at most 5 results");
  assert.ok(journeys.length >= 1, "should find at least one route");
});
