/**
 * Property-based tests for the journey planner (Phase 7)
 *
 * These tests verify invariants that must hold for ALL inputs, not just
 * hand-picked examples. They complement the unit tests in planner.test.js.
 */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/busData.json");
const { createPlanner, normalize } = require("../backend/planner");

const planner = createPlanner(data);
const stops = planner.stops();

// ---------------------------------------------------------------------------
// normalize() properties
// ---------------------------------------------------------------------------

test("normalize: idempotent — normalize(normalize(s)) === normalize(s)", () => {
  const inputs = [
    "State Bank",
    "LALBAGH",
    "  kankanady  ",
    "Bajpe Airport",
    "",
    "K.S.R.T.C.",
    "mangaluru",
    "  ",
    "MINgal-uru",
    "123 BUS STOP",
    "stop with   multiple   spaces",
    "UDUPI  ",
    "   KADRI",
  ];
  for (const s of inputs) {
    const once = normalize(s);
    const twice = normalize(once);
    assert.equal(twice, once, `normalize not idempotent for "${s}"`);
  }
});

test("normalize: returns a string for any input", () => {
  const inputs = ["", "   ", "ABC", "123", "stop (main)", "a-b", "X & Y"];
  for (const s of inputs) {
    assert.equal(typeof normalize(s), "string");
  }
});

test("normalize: trims whitespace", () => {
  assert.equal(normalize("  Lalbagh  "), normalize("Lalbagh"));
  assert.equal(normalize("\tState Bank\n"), normalize("State Bank"));
});

test("normalize: is case-insensitive (lower-cases)", () => {
  assert.equal(normalize("LALBAGH"), normalize("lalbagh"));
  assert.equal(normalize("State Bank"), normalize("state bank"));
});

// ---------------------------------------------------------------------------
// planner.stops() properties
// ---------------------------------------------------------------------------

test("stops(): returns a non-empty array of strings", () => {
  assert.ok(Array.isArray(stops));
  assert.ok(stops.length > 0, "stops list is empty");
  for (const s of stops) {
    assert.equal(typeof s, "string");
    assert.ok(s.length > 0, "empty stop name in list");
  }
});

test("stops(): no duplicates", () => {
  const seen = new Set();
  for (const s of stops) {
    assert.ok(!seen.has(s), `duplicate stop: "${s}"`);
    seen.add(s);
  }
});

// ---------------------------------------------------------------------------
// planner.plan() properties
// ---------------------------------------------------------------------------

test("plan(A, A): same stop returns empty array", () => {
  for (const stop of stops.slice(0, 20)) {
    // first 20 for speed
    const result = planner.plan(stop, stop);
    assert.ok(Array.isArray(result), `plan(${stop}, ${stop}) is not an array`);
    assert.equal(
      result.length,
      0,
      `plan(${stop}, ${stop}) returned ${result.length} journeys; expected 0`,
    );
  }
});

test("plan(from, to): all results have changes >= 0", () => {
  const sample = stops.slice(0, 10);
  for (const from of sample) {
    for (const to of sample) {
      if (from === to) continue;
      for (const j of planner.plan(from, to)) {
        assert.ok(j.changes >= 0, `Negative changes: ${from}→${to}`);
      }
    }
  }
});

test("plan(from, to): all results have rides >= 1", () => {
  const sample = stops.slice(0, 10);
  for (const from of sample) {
    for (const to of sample) {
      if (from === to) continue;
      for (const j of planner.plan(from, to)) {
        assert.ok(j.rides >= 1, `rides < 1 for ${from}→${to}`);
      }
    }
  }
});

test("plan(from, to): every journey has at least one leg with at least one bus", () => {
  const sample = stops.slice(0, 15);
  for (const from of sample) {
    for (const to of sample) {
      if (from === to) continue;
      for (const j of planner.plan(from, to)) {
        assert.ok(j.legs.length >= 1);
        for (const leg of j.legs) {
          assert.ok(
            Array.isArray(leg.buses) && leg.buses.length >= 1,
            `Leg ${leg.from}→${leg.to}: no buses`,
          );
        }
      }
    }
  }
});

test("plan(from, to): results are sorted by changes asc, then rides asc", () => {
  const sample = stops.slice(0, 15);
  for (const from of sample) {
    for (const to of sample) {
      if (from === to) continue;
      const journeys = planner.plan(from, to);
      for (let i = 1; i < journeys.length; i++) {
        const a = journeys[i - 1];
        const b = journeys[i];
        const ok =
          a.changes < b.changes ||
          (a.changes === b.changes && a.rides <= b.rides);
        assert.ok(
          ok,
          `${from}→${to}: journeys[${i - 1}] (${a.changes}ch/${a.rides}r) not before journeys[${i}] (${b.changes}ch/${b.rides}r)`,
        );
      }
    }
  }
});

test("plan(from, to): no duplicate journey keys in results", () => {
  const sample = stops.slice(0, 10);
  for (const from of sample) {
    for (const to of sample) {
      if (from === to) continue;
      const journeys = planner.plan(from, to);
      const keys = journeys.map((j) => j.legs.map((l) => l.stops.join("|")).join(">"));
      const keySet = new Set(keys);
      assert.equal(
        keySet.size,
        keys.length,
        `${from}→${to}: duplicate journey in results`,
      );
    }
  }
});

test("plan(from, to): every journey has a rankingNote string", () => {
  const sample = stops.slice(0, 10);
  for (const from of sample) {
    for (const to of sample) {
      if (from === to) continue;
      for (const j of planner.plan(from, to)) {
        assert.equal(
          typeof j.rankingNote,
          "string",
          `${from}→${to}: missing rankingNote`,
        );
        assert.ok(j.rankingNote.length > 0, `${from}→${to}: empty rankingNote`);
      }
    }
  }
});

