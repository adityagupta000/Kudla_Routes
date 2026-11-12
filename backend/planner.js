/**
 * planner.js — everything "smart" about the app lives here. No dependencies.
 *
 * The idea in one paragraph:
 *   Pick any stop A. One bus can take you from A to every other stop on that bus's
 *   route. Call that set reach(A). A journey is then just a chain of hops:
 *     direct          B in reach(A)
 *     one change      some X in reach(A) and reach(B)        (A -> X -> B)
 *     two changes     X in reach(A), Y in reach(B), Y in reach(X)
 *   Every journey is scored as  stops ridden + a penalty for each change of bus,
 *   and the cheapest few are returned. Buses are assumed to run both ways.
 */

const CHANGE_PENALTY = 6; // changing bus "costs" about 6 extra stops (waiting + walking)
const MAX_RESULTS = 5;
const SEARCH_LIMIT = 8;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const naturalCompare = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true });

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[b.length];
}

const similarity = (a, b) =>
  1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

function createPlanner(data) {
  const buses = data.buses.map((bus) => ({
    ...bus,
    position: new Map(bus.stops.map((stop, i) => [stop, i])),
  }));
  const busByNumber = new Map(buses.map((bus) => [bus.number, bus]));

  // stop -> every bus that serves it
  const busesAtStop = new Map();
  for (const bus of buses) {
    for (const stop of bus.stops) {
      if (!busesAtStop.has(stop)) busesAtStop.set(stop, []);
      busesAtStop.get(stop).push(bus);
    }
  }

  // Everything a person might type -> the real stop name.
  const names = new Map();
  for (const stop of busesAtStop.keys()) names.set(normalize(stop), stop);
  for (const [alias, stop] of Object.entries(data.aliases || {})) {
    const key = normalize(alias);
    if (busesAtStop.has(stop) && !names.has(key)) names.set(key, stop);
  }

  // ---------------------------------------------------------------------------
  // Stop search: used by autocomplete and to forgive typos
  // ---------------------------------------------------------------------------
  function search(query, limit = SEARCH_LIMIT) {
    const q = normalize(query);
    const scored = new Map(); // real stop name -> best score

    for (const [key, stop] of names) {
      let score = 0;
      if (!q)
        score = 0.1; // empty box: just show the busiest stops
      else if (key === q) score = 1;
      else if (key.startsWith(q)) score = 0.9;
      else if (key.split(" ").some((word) => word.startsWith(q)))
        score = 0.8; // "bank" -> State Bank
      else if (key.includes(q)) score = 0.7;
      else {
        const closest = Math.max(
          similarity(q, key),
          ...key.split(" ").map((w) => similarity(q, w)),
        );
        if (closest >= 0.6) score = closest * 0.69; // typo-tolerant, always below a real substring hit
      }
      if (score > (scored.get(stop) || 0)) scored.set(stop, score);
    }

    return [...scored]
      .map(([stop, score]) => ({
        stop,
        score,
        buses: busesAtStop.get(stop).length,
      }))
      .filter((hit) => hit.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.buses - a.buses ||
          a.stop.localeCompare(b.stop),
      )
      .slice(0, limit);
  }

  // Turn what the person typed into one real stop, or a list of "did you mean".
  function resolve(input) {
    const key = normalize(input);
    if (names.has(key)) return { stop: names.get(key), corrected: false };

    const hits = search(input, 5);
    const [first, second] = hits;
    if (
      first &&
      first.score >= 0.55 &&
      (!second || first.score - second.score >= 0.1)
    ) {
      return { stop: first.stop, corrected: true }; // one clear winner: a typo or a unique prefix
    }
    return { stop: null, suggestions: hits.map((hit) => hit.stop) };
  }

  // ---------------------------------------------------------------------------
  // reach(A): every stop one bus can take you to from A
  // ---------------------------------------------------------------------------
  const reachCache = new Map();

  function reach(from) {
    if (reachCache.has(from)) return reachCache.get(from);

    const result = new Map(); // stop -> { signature -> option }
    for (const bus of busesAtStop.get(from) || []) {
      const i = bus.position.get(from);
      bus.stops.forEach((to, j) => {
        if (to === from) return;
        const stops =
          i < j
            ? bus.stops.slice(i, j + 1)
            : bus.stops.slice(j, i + 1).reverse();
        const signature = stops.join(">");
        if (!result.has(to)) result.set(to, new Map());
        const options = result.get(to);
        if (!options.has(signature))
          options.set(signature, { buses: [], stops, rides: stops.length - 1 });
        options.get(signature).buses.push(bus.number);
      });
    }

    // Buses that run the exact same road are one option ("17, 17A, 17B").
    const sorted = new Map();
    for (const [to, options] of result) {
      const list = [...options.values()];
      list.forEach((o) => o.buses.sort(naturalCompare));
      list.sort((a, b) => a.rides - b.rides || b.buses.length - a.buses.length);
      sorted.set(to, list);
    }
    reachCache.set(from, sorted);
    return sorted;
  }

  const toLeg = (from, to, option, everyBus) => ({
    buses: option.buses,
    from,
    to,
    rides: option.rides,
    stops: option.stops,
    // A group of buses is only as trustworthy as its least-confirmed bus.
    confidence: option.buses
      .map((n) => busByNumber.get(n).confidence)
      .sort((a, b) => CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b])[0],
    everyBus, // every bus that links these two stops (used to spot pointless changes)
  });

  const legBetween = (from, to, optionIndex = 0) => {
    const options = reach(from).get(to);
    return toLeg(
      from,
      to,
      options[optionIndex],
      new Set(options.flatMap((o) => o.buses)),
    );
  };

  // A change is pointless if one bus already serves two of the legs: just stay on it.
  const hasPointlessChange = (legs) => {
    const seen = new Set();
    for (const leg of legs) {
      for (const bus of leg.everyBus) {
        if (seen.has(bus)) return true;
      }
      leg.everyBus.forEach((bus) => seen.add(bus));
    }
    return false;
  };

  const makeJourney = (legs) => ({
    changes: legs.length - 1,
    rides: legs.reduce((sum, leg) => sum + leg.rides, 0),
    cost:
      legs.reduce((sum, leg) => sum + leg.rides, 0) +
      CHANGE_PENALTY * (legs.length - 1),
    legs: legs.map(({ everyBus, ...leg }) => leg),
  });

  // ---------------------------------------------------------------------------
  // plan(A, B): the ranked list of ways to get there
  // ---------------------------------------------------------------------------
  function plan(from, to) {
    const fromReach = reach(from);
    const toReach = reach(to);
    const candidates = [];

    // Direct: every distinct road a bus takes between the two stops.
    const direct = fromReach.get(to) || [];
    const directBuses = new Set(direct.flatMap((o) => o.buses));
    direct.forEach((option) =>
      candidates.push([toLeg(from, to, option, directBuses)]),
    );

    // One change: a stop that both ends can reach.
    for (const x of fromReach.keys()) {
      if (x === to || !toReach.has(x)) continue;
      candidates.push([legBetween(from, x), legBetween(x, to)]);
    }

    let journeys = rank(candidates);

    // Two changes: only when there is no direct bus and the simple options are thin.
    if (direct.length === 0 && journeys.length < 3) {
      for (const x of fromReach.keys()) {
        if (x === to) continue;
        const xReach = reach(x);
        for (const y of toReach.keys()) {
          if (y === from || y === x || !xReach.has(y)) continue;
          candidates.push([
            legBetween(from, x),
            legBetween(x, y),
            legBetween(y, to),
          ]);
        }
      }
      journeys = rank(candidates);
    }
    return journeys;
  }

  // Cheapest first; keep one journey per sequence of buses (changing at the next stop
  // along the same two roads is not a real alternative).
  function rank(candidates) {
    const best = new Map();
    for (const legs of candidates) {
      if (hasPointlessChange(legs)) continue;
      const journey = makeJourney(legs);
      const key = journey.legs.map((leg) => leg.buses[0]).join(">");
      if (!best.has(key) || journey.cost < best.get(key).cost)
        best.set(key, journey);
    }
    return [...best.values()]
      .sort((a, b) => a.cost - b.cost || a.changes - b.changes)
      .slice(0, MAX_RESULTS);
  }

  // ---------------------------------------------------------------------------
  // Plain lookups
  // ---------------------------------------------------------------------------
  const describe = ({ id, number, confidence, note, stops }) => ({
    id,
    number,
    from: stops[0],
    to: stops[stops.length - 1],
    confidence,
    ...(note ? { note } : {}),
    stops,
  });

  return {
    search,
    resolve,
    plan,
    getBus: (number) => {
      const bus = busByNumber.get(String(number).toUpperCase());
      return bus ? describe(bus) : null;
    },
    listBuses: () => buses.map(describe),
    busiestStops: (n = 3) => search("", n).map((hit) => hit.stop),
    stopCount: busesAtStop.size,
    stops: () => [...busesAtStop.keys()],
  };
}

module.exports = { createPlanner, normalize, CHANGE_PENALTY };
