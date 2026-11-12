/**
 * Exhaustive journey-planner tests (Phase 7)
 *
 * Runs every stop → every stop pair through the planner and verifies that
 * every returned journey is structurally valid:
 *   - at most 2 changes
 *   - legs join up end-to-end
 *   - each leg's stop list matches its .from / .to fields
 *   - results are sorted: fewer changes first, then fewer rides
 *
 * This O(n²) integrity check is part of the full npm test suite.
 */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/busData.json");
const { createPlanner } = require("../backend/planner");

const planner = createPlanner(data);
const stops = planner.stops();

test("exhaustive: all journey legs are structurally valid", (t) => {
  let unreachable = 0;
  let total = 0;

  for (const from of stops) {
    for (const to of stops) {
      if (from === to) continue;
      total++;

      const journeys = planner.plan(from, to);

      if (!journeys.length) {
        unreachable++;
        continue;
      }

      for (const j of journeys) {
        // At most 2 changes
        assert.ok(
          j.changes <= 2,
          `${from}→${to}: found ${j.changes} changes (max is 2)`,
        );

        // First leg starts at from, last leg ends at to
        assert.equal(
          j.legs[0].from,
          from,
          `${from}→${to}: first leg starts at ${j.legs[0].from}`,
        );
        assert.equal(
          j.legs.at(-1).to,
          to,
          `${from}→${to}: last leg ends at ${j.legs.at(-1).to}`,
        );

        // Legs join up
        for (let i = 1; i < j.legs.length; i++) {
          assert.equal(
            j.legs[i].from,
            j.legs[i - 1].to,
            `${from}→${to}: leg ${i} starts at "${j.legs[i].from}" but leg ${i - 1} ends at "${j.legs[i - 1].to}"`,
          );
        }

        // Each leg's stop array matches its from/to
        for (const leg of j.legs) {
          for (const number of leg.buses) {
            const bus = data.buses.find((candidate) => candidate.number === number);
            assert.ok(bus, `${from}→${to}: unknown bus ${number}`);
            const startIndex = bus.stops.indexOf(leg.from);
            const endIndex = bus.stops.indexOf(leg.to);
            assert.ok(
              startIndex >= 0 && endIndex > startIndex,
              `${number} cannot travel ${leg.from}→${leg.to} forward`,
            );
            assert.deepEqual(
              leg.stops,
              bus.stops.slice(startIndex, endIndex + 1),
              `${number} does not serve the reported ordered leg`,
            );
          }

          assert.equal(
            leg.stops[0],
            leg.from,
            `Leg ${leg.from}→${leg.to}: stops[0]="${leg.stops[0]}" ≠ leg.from`,
          );
          assert.equal(
            leg.stops.at(-1),
            leg.to,
            `Leg ${leg.from}→${leg.to}: stops[-1]="${leg.stops.at(-1)}" ≠ leg.to`,
          );

          // At least 2 stops per leg
          assert.ok(
            leg.stops.length >= 2,
            `Leg ${leg.from}→${leg.to}: only ${leg.stops.length} stop(s)`,
          );

          // rides count matches the gap in the stop list
          assert.equal(
            leg.rides,
            leg.stops.length - 1,
            `Leg ${leg.from}→${leg.to}: rides=${leg.rides} but stops.length-1=${leg.stops.length - 1}`,
          );
        }

        for (let i = 0; i < j.legs.length - 1; i++) {
          const start = j.legs[i].from;
          const end = j.legs[i + 1].to;
          const firstLegBuses = new Set(j.legs[i].buses);
          const canStayOnOneBus = data.buses.some((bus) => {
            const startIndex = bus.stops.indexOf(start);
            return firstLegBuses.has(bus.number) &&
              startIndex >= 0 &&
              bus.stops.indexOf(end) > startIndex;
          });
          assert.equal(
            canStayOnOneBus,
            false,
            `${from}→${to}: transfer at ${j.legs[i].to} is avoidable`,
          );
        }

        // Changes count matches the number of legs minus 1
        assert.equal(
          j.changes,
          j.legs.length - 1,
          `${from}→${to}: j.changes=${j.changes} but legs.length-1=${j.legs.length - 1}`,
        );

        // evidence object present on every leg
        for (const leg of j.legs) {
          assert.ok(
            leg.evidence && typeof leg.evidence === "object",
            `Leg ${leg.from}→${leg.to}: missing evidence object`,
          );
        }
      }

      // Sorted: fewer changes first, then fewer rides
      for (let k = 1; k < journeys.length; k++) {
        const a = journeys[k - 1];
        const b = journeys[k];
        assert.ok(
          a.changes < b.changes ||
            (a.changes === b.changes && a.rides <= b.rides),
          `${from}→${to}: journeys[${k - 1}] (${a.changes} changes, ${a.rides} rides) should come before journeys[${k}] (${b.changes} changes, ${b.rides} rides)`,
        );
      }
    }
  }

  const pct = ((unreachable / total) * 100).toFixed(1);
  console.log(`Pairs checked: ${total} | Unreachable: ${unreachable} (${pct}%)`);
  t.diagnostic(
    `Checked ${total} stop pairs. ${unreachable} (${pct}%) had no route.`,
  );
});

test("exhaustive: no journey result has empty legs array", () => {
  for (const from of stops) {
    for (const to of stops) {
      if (from === to) continue;
      const journeys = planner.plan(from, to);
      for (const j of journeys) {
        assert.ok(
          j.legs.length >= 1,
          `${from}→${to}: journey has empty legs array`,
        );
      }
    }
  }
});

test("exhaustive: rides total equals sum of leg rides", () => {
  for (const from of stops) {
    for (const to of stops) {
      if (from === to) continue;
      for (const j of planner.plan(from, to)) {
        const sumRides = j.legs.reduce((s, l) => s + l.rides, 0);
        assert.equal(
          j.rides,
          sumRides,
          `${from}→${to}: j.rides=${j.rides} but sum of leg rides=${sumRides}`,
        );
      }
    }
  }
});

