const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/busData.json");
const { createPlanner } = require("../backend/planner");

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

test("buses run both ways", () => {
  const [best] = planner.plan("Kunjathbail", "State Bank");
  assert.deepEqual(best.legs[0].buses, ["1"]);
  assert.equal(best.legs[0].stops[0], "Kunjathbail");
  assert.equal(best.legs[0].stops.at(-1), "State Bank");
});

test("with no direct bus, it offers several ways with a change", () => {
  const journeys = planner.plan("Mangaladevi", "Bajpe Airport");
  assert.ok(journeys.length >= 3, "expected alternatives");
  assert.ok(journeys.every((j) => j.changes >= 1));
  const changeStops = new Set(journeys.map((j) => j.legs[0].to));
  assert.ok(
    changeStops.size > 1,
    "alternatives should change at different places",
  );
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
  // 2 serves both Lalbagh and Surathkal, so no journey should need a change to get there
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

test("fewer stops + fewer changes means a lower cost", () => {
  const journeys = planner.plan("Surathkal", "Ullal");
  for (let i = 1; i < journeys.length; i++)
    assert.ok(journeys[i].cost >= journeys[i - 1].cost);
});

test("every stop can reach every busiest stop, in both directions", () => {
  const hubs = planner.busiestStops(3);
  for (const stop of planner.stops()) {
    for (const hub of hubs) {
      if (stop === hub) continue;
      assert.ok(planner.plan(stop, hub).length > 0, `${stop} -> ${hub}`);
      assert.ok(planner.plan(hub, stop).length > 0, `${hub} -> ${stop}`);
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
