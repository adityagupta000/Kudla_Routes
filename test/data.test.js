// Guards the bus data against the mistakes that were in the original file.
const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/busData.json");
const { normalize } = require("../backend/planner");

const allStops = new Set(data.buses.flatMap((bus) => bus.stops));

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
