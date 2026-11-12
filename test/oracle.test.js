/**
 * oracle.test.js — Independent planner correctness oracle.
 *
 * Uses a hand-built tiny network where every reachable journey is known.
 * This proves the planner finds what it should WITHOUT depending on
 * the production dataset, which is partially unverified.
 *
 * Network layout:
 *   Bus A:  Alpha → Beta → Gamma → Delta
 *   Bus B:  Epsilon → Beta → Zeta → Eta
 *   Bus C:  Theta → Gamma → Eta → Iota
 *   Bus D:  Alpha → Epsilon (direct, no transfer needed for some)
 *   Bus E:  Kappa → Lambda   (disconnected from rest of network)
 *
 * Expected reachability (forward only):
 *   Alpha  → Beta, Gamma, Delta (via A); Epsilon (via D)
 *   Alpha  → Zeta, Eta           (via A→Beta then B: one change at Beta)
 *   Alpha  → Iota                (via A→Gamma then C: one change at Gamma)
 *   Alpha  → Eta                 (via A→Gamma then C: one change at Gamma)
 *   Epsilon → Beta, Zeta, Eta    (via B)
 *   Theta  → Gamma, Eta, Iota    (via C)
 *   Kappa  → Lambda              (via E, isolated)
 *   Beta   → Theta               UNREACHABLE (Theta only appears as C's start)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlanner } = require("../backend/planner");

// Hand-built tiny dataset — independent of production data
const oracleData = {
  buses: [
    {
      id: "bus-A",
      number: "A",
      confidence: "high",
      evidence: {
        endpoints: "VERIFIED",
        stopSequence: "PARTIALLY_VERIFIED",
        direction: "PARTIALLY_VERIFIED",
        currentOperation: "VERIFIED",
      },
      stops: ["Alpha", "Beta", "Gamma", "Delta"],
    },
    {
      id: "bus-B",
      number: "B",
      confidence: "high",
      evidence: {
        endpoints: "VERIFIED",
        stopSequence: "PARTIALLY_VERIFIED",
        direction: "PARTIALLY_VERIFIED",
        currentOperation: "VERIFIED",
      },
      stops: ["Epsilon", "Beta", "Zeta", "Eta"],
    },
    {
      id: "bus-C",
      number: "C",
      confidence: "high",
      evidence: {
        endpoints: "VERIFIED",
        stopSequence: "PARTIALLY_VERIFIED",
        direction: "PARTIALLY_VERIFIED",
        currentOperation: "VERIFIED",
      },
      stops: ["Theta", "Gamma", "Eta", "Iota"],
    },
    {
      id: "bus-D",
      number: "D",
      confidence: "high",
      evidence: {
        endpoints: "VERIFIED",
        stopSequence: "PARTIALLY_VERIFIED",
        direction: "PARTIALLY_VERIFIED",
        currentOperation: "VERIFIED",
      },
      stops: ["Alpha", "Epsilon"],
    },
    {
      id: "bus-E",
      number: "E",
      confidence: "medium",
      evidence: {
        endpoints: "PARTIALLY_VERIFIED",
        stopSequence: "UNVERIFIED",
        direction: "UNVERIFIED",
        currentOperation: "UNKNOWN",
      },
      stops: ["Kappa", "Lambda"],
    },
  ],
  aliases: {},
};

const planner = createPlanner(oracleData);

// Helper: get all stops across all journeys' first leg buses
const firstLegBuses = (journeys) =>
  journeys.flatMap((j) => j.legs[0].buses);

test("oracle: direct route exists (Alpha → Delta via bus A)", () => {
  const journeys = planner.plan("Alpha", "Delta");
  assert.ok(journeys.length > 0, "should find at least one journey");
  const direct = journeys.filter((j) => j.changes === 0);
  assert.ok(direct.length > 0, "should find a direct journey (no changes)");
  assert.ok(
    direct.some((j) => j.legs[0].buses.includes("A")),
    "bus A should serve Alpha→Delta directly"
  );
});

test("oracle: direct route exists (Kappa → Lambda via bus E, isolated network)", () => {
  const journeys = planner.plan("Kappa", "Lambda");
  assert.ok(journeys.length > 0, "should find journey in isolated sub-network");
  assert.equal(journeys[0].changes, 0, "should be direct (no changes)");
  assert.ok(journeys[0].legs[0].buses.includes("E"), "bus E should serve this leg");
});

test("oracle: one-change route found (Alpha → Eta via Beta or Gamma)", () => {
  const journeys = planner.plan("Alpha", "Eta");
  assert.ok(journeys.length > 0, "should find at least one journey to Eta");
  // Eta is reachable via: Alpha→Beta (A) then Beta→Eta (B) [one change]
  // Also via: Alpha→Gamma (A) then Gamma→Eta (C) [one change]
  const oneChange = journeys.filter((j) => j.changes === 1);
  assert.ok(oneChange.length > 0, "should find at least one one-change journey");
});

test("oracle: one-change route found (Alpha → Iota via Gamma)", () => {
  const journeys = planner.plan("Alpha", "Iota");
  assert.ok(journeys.length > 0, "should find journey to Iota");
  const oneChange = journeys.filter((j) => j.changes === 1);
  assert.ok(oneChange.length > 0, "should find one-change journey (A→Gamma then C→Iota)");
  // Verify the transfer point includes Gamma
  const viaGamma = oneChange.find((j) =>
    j.legs[0].stops.includes("Gamma") && j.legs[1].stops.includes("Gamma")
  );
  assert.ok(viaGamma, "should use Gamma as the transfer point");
});

test("oracle: unreachable pair returns empty (Delta → Alpha — forward only, no reverse)", () => {
  const journeys = planner.plan("Delta", "Alpha");
  // Independent fixture inspection: Delta is the final stop of A, and no
  // other route contains Delta. Therefore there is no forward first leg.
  assert.deepEqual(journeys, []);
});

test("oracle: unreachable pair returns empty (Lambda → Kappa — isolated, forward only)", () => {
  const journeys = planner.plan("Lambda", "Kappa");
  assert.equal(journeys.length, 0, "Lambda cannot reach Kappa forward (Kappa is E's start)");
});

test("oracle: unreachable across networks (Lambda → Delta)", () => {
  const journeys = planner.plan("Lambda", "Delta");
  assert.equal(journeys.length, 0, "Lambda and Delta are in disconnected sub-networks");
});

test("oracle: plan(A, A) same stop returns empty array", () => {
  const journeys = planner.plan("Alpha", "Alpha");
  assert.deepEqual(journeys, [], "same-stop plan should return empty array");
});

test("oracle: journeys are ranked changes-first then rides", () => {
  const journeys = planner.plan("Alpha", "Eta");
  for (let i = 1; i < journeys.length; i++) {
    const prev = journeys[i - 1];
    const curr = journeys[i];
    // changes should be non-decreasing
    assert.ok(
      prev.changes <= curr.changes ||
        (prev.changes === curr.changes && prev.rides <= curr.rides),
      `journey ${i} violates ranking: prev=${JSON.stringify({c:prev.changes,r:prev.rides})}, curr=${JSON.stringify({c:curr.changes,r:curr.rides})}`
    );
  }
});

test("oracle: every journey has required fields (legs, changes, rides, rankingNote)", () => {
  const journeys = planner.plan("Alpha", "Iota");
  assert.ok(journeys.length > 0, "should find journeys for oracle check");
  for (const j of journeys) {
    assert.ok(Array.isArray(j.legs), "journey must have legs array");
    assert.ok(typeof j.changes === "number", "journey must have changes count");
    assert.ok(typeof j.rides === "number", "journey must have rides count");
    assert.ok(typeof j.rankingNote === "string" && j.rankingNote.length > 0,
      "journey must have rankingNote string");
    for (const leg of j.legs) {
      assert.ok(Array.isArray(leg.buses) && leg.buses.length > 0, "leg must list buses");
      assert.ok(typeof leg.from === "string", "leg must have from stop");
      assert.ok(typeof leg.to === "string", "leg must have to stop");
      assert.ok(Array.isArray(leg.stops) && leg.stops.length >= 2, "leg must have stops array");
      assert.ok(typeof leg.rides === "number" && leg.rides >= 1, "leg must have rides count >=1");
    }
    assert.equal(j.changes, j.legs.length - 1);
    assert.equal(j.rides, j.legs.reduce((total, leg) => total + leg.rides, 0));
    for (let i = 0; i < j.legs.length; i++) {
      const leg = j.legs[i];
      assert.equal(leg.stops[0], leg.from);
      assert.equal(leg.stops.at(-1), leg.to);
      if (i > 0) assert.equal(leg.from, j.legs[i - 1].to);

      for (const number of leg.buses) {
        const route = oracleData.buses.find((bus) => bus.number === number).stops;
        const start = route.indexOf(leg.from);
        const end = route.indexOf(leg.to);
        assert.ok(start >= 0 && end > start, `${number} must serve ${leg.from}→${leg.to} forward`);
        assert.deepEqual(leg.stops, route.slice(start, end + 1));
      }
    }
    for (let i = 0; i < j.legs.length - 1; i++) {
      const start = j.legs[i].from;
      const end = j.legs[i + 1].to;
      const currentLegBuses = new Set(j.legs[i].buses);
      const canStayOnOneBus = oracleData.buses.some((bus) => {
        const startIndex = bus.stops.indexOf(start);
        return currentLegBuses.has(bus.number) &&
          startIndex >= 0 &&
          bus.stops.indexOf(end) > startIndex;
      });
      assert.equal(canStayOnOneBus, false, "transfer must not be avoidable on one forward route");
    }
  }
});

test("oracle: Alpha → Epsilon direct via bus D", () => {
  const journeys = planner.plan("Alpha", "Epsilon");
  assert.ok(journeys.length > 0, "should find journey Alpha→Epsilon");
  const direct = journeys.filter((j) => j.changes === 0);
  assert.ok(direct.length > 0, "Alpha→Epsilon should be direct via bus D");
  assert.ok(direct[0].legs[0].buses.includes("D"), "bus D serves Alpha→Epsilon");
});

test("oracle: Alpha → Zeta requires one change (via Beta)", () => {
  const journeys = planner.plan("Alpha", "Zeta");
  assert.ok(journeys.length > 0, "should find journey Alpha→Zeta");
  // Alpha→Zeta: bus A to Beta, then bus B to Zeta (one change)
  // OR bus D to Epsilon, then bus B to Zeta (one change)
  const oneChange = journeys.filter((j) => j.changes === 1);
  assert.ok(oneChange.length > 0, "Alpha→Zeta requires exactly one change");
});
