/**
 * planner.js — everything "smart" about the app lives here. No dependencies.
 *
 * The idea in one paragraph:
 *   Pick any stop A. One bus can take you from A to every other stop LATER in
 *   that bus's route pattern. Call that set reach(A). A journey is then a chain:
 *     direct          B in reach(A)
 *     one change      some X in reach(A) and reach(B)        (A -> X -> B)
 *     two changes     X in reach(A), Y in reach(B), Y in reach(X)
 *   Journeys are ranked by: (1) fewer transfers first, (2) fewer stops. The cost field is used as a tiebreaker only.
 *
 * Direction model (Phase 2):
 *   Each bus record stores ONE ordered stop sequence representing one direction.
 *   The dataset does NOT include verified return directions for any route.
 *   This planner therefore only traverses stop sequences in their stored forward
 *   direction. It does NOT assume a bus can be taken in reverse.
 *
 *   This is a behavioural change from previous versions that assumed
 *   bidirectionality. Routes can be found in both directions only when two
 *   direction patterns exist in the dataset — currently none do.
 *
 * Ranking (Phase 3):
 *   Journeys are ranked by: (1) fewer transfers, (2) fewer ride segments.
 *   This is a heuristic — it does not represent travel time or service frequency.
 *   A fixed transfer penalty is NOT used for primary ranking; instead, transfer
 *   count is the primary sort key so the fewest-transfer option always appears
 *   first regardless of stop count.
 */

const MAX_RESULTS = 5;
const AUTOCOMPLETE_LIMIT = 8;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

const EVIDENCE_STATUSES = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
  "CONFLICTING",
  "HISTORICAL",
  "UNKNOWN",
];

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
    // position map: stop name -> index in stop sequence
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
  function search(query, limit = AUTOCOMPLETE_LIMIT) {
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
  // reach(from): every stop reachable from `from` by travelling FORWARD through
  // any bus pattern that includes `from`. Does NOT traverse in reverse.
  //
  // Phase 2 change: previous version also traversed i > j (reverse direction),
  // which fabricated journeys in unverified directions. This version only
  // traverses forward (stops with index > i).
  // ---------------------------------------------------------------------------
  const reachCache = new Map();

  function reach(from) {
    if (reachCache.has(from)) return reachCache.get(from);

    const result = new Map(); // stop -> { signature -> option }
    for (const bus of busesAtStop.get(from) || []) {
      const i = bus.position.get(from);
      // Only traverse FORWARD: stops with index j > i
      bus.stops.slice(i + 1).forEach((to, offset) => {
        const j = i + 1 + offset;
        const stops = bus.stops.slice(i, j + 1); // forward slice only
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

  // Compute the weakest (lowest-ranked) evidence dimension across buses in a leg.
  // Returns the evidence object for the leg.
  const legEvidence = (busNumbers) => {
    const evidenceRank = (status) => EVIDENCE_STATUSES.indexOf(status); // lower = stronger
    const busEvidences = busNumbers.map((n) => busByNumber.get(n).evidence).filter(Boolean);
    if (busEvidences.length === 0) return null;
    // For each dimension, pick the weakest (highest rank index = least verified)
    const weakest = (dim) => {
      const statuses = busEvidences.map((e) => e[dim] || "UNKNOWN");
      return statuses.reduce((worst, s) =>
        evidenceRank(s) > evidenceRank(worst) ? s : worst,
      );
    };
    return {
      endpoints: weakest("endpoints"),
      stopSequence: weakest("stopSequence"),
      direction: weakest("direction"),
      currentOperation: weakest("currentOperation"),
    };
  };

  const toLeg = (from, to, option, everyBus) => ({
    buses: option.buses,
    from,
    to,
    rides: option.rides,
    stops: option.stops,
    // Legacy: least-confident bus confidence (for backward compatibility)
    confidence: option.buses
      .map((n) => busByNumber.get(n).confidence)
      .sort((a, b) => CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b])[0],
    // Phase 1/2: per-dimension evidence (weakest across grouped buses)
    evidence: legEvidence(option.buses),
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

  // A change is pointless when a single bus already serves forward from
  // legs[i].from to legs[i+1].to — the passenger could have stayed on board.
  //
  // The old set-overlap test was wrong: it used everyBus (all buses serving a
  // stop pair) and fired whenever the same bus appeared in two different legs'
  // everyBus sets, even when that bus could only serve those stops in opposite
  // directions. For example, bus 1B runs […, Ladyhill, Chilimbi, Urva Stores,
  // Kodikal]. It is in everyBus for Urva→Kodikal and also appears in everyBus
  // for a later leg involving Chilimbi, but it CANNOT go Urva→Chilimbi forward.
  // The old test rejected that journey incorrectly.
  //
  // Correct test (adjacent-pair forward check):
  //   For each adjacent pair of legs (i, i+1), ask: does any bus that serves
  //   legs[i] also reach legs[i+1].to from legs[i].from in its stored forward
  //   sequence? If yes, the passenger could have stayed on and the change is
  //   pointless.
  const hasPointlessChange = (legs) => {
    for (let i = 0; i < legs.length - 1; i++) {
      const startStop = legs[i].from;
      const endStop   = legs[i + 1].to;
      for (const busNum of legs[i].everyBus) {
        const bus = busByNumber.get(busNum);
        if (!bus) continue;
        const si = bus.position.get(startStop);
        const ei = bus.position.get(endStop);
        // Both stops on this bus's route and the end comes AFTER the start
        if (si !== undefined && ei !== undefined && ei > si) return true;
      }
    }
    return false;
  };

  const makeJourney = (legs) => ({
    changes: legs.length - 1,
    rides: legs.reduce((sum, leg) => sum + leg.rides, 0),
    // cost is NOT part of the public API; ranking is by changes then rides then bus ID.
    // Keep it on the object during rank() deduplication, strip it in rank() before returning.
    _cost:
      legs.reduce((sum, leg) => sum + leg.rides, 0) +
      6 * (legs.length - 1),
    legs: legs.map(({ everyBus, ...leg }) => leg),
    rankingNote:
      "Ranked by fewer transfers first, then fewer stops. This is a heuristic — not travel time.",
  });

  // ---------------------------------------------------------------------------
  // plan(A, B): the ranked list of ways to get there
  //
  // With forward-only traversal (Phase 2), "reach" is directional:
  //   reach(S) = all stops reachable FROM S in the forward direction of any bus.
  //
  // For a transfer at X to work: from→X (forward) AND X→to (forward) must both
  // exist. We compute reachableToDestination (all stops that can reach `to`
  // in one forward hop) by collecting stops for which reach(stop).has(to).
  //
  // Phase 3 changes:
  //   - Two-change search always runs when there is no direct bus
  //   - Deduplication key uses stop-sequence path, not just first bus number
  // ---------------------------------------------------------------------------
  function plan(from, to) {
    // Guard: same normalised stop name → no journey needed
    if (normalize(from) === normalize(to)) return [];

    const fromReach = reach(from);
    const candidates = [];

    // Direct: every distinct road a bus takes between the two stops.
    const direct = fromReach.get(to) || [];
    const directBuses = new Set(direct.flatMap((o) => o.buses));
    direct.forEach((option) =>
      candidates.push([toLeg(from, to, option, directBuses)]),
    );

    // One change: find stops X where:
    //   1. from can reach X forward (X in fromReach)
    //   2. X can reach to forward (to in reach(X))
    for (const x of fromReach.keys()) {
      if (x === to) continue;
      const xReach = reach(x);
      if (!xReach.has(to)) continue;
      candidates.push([legBetween(from, x), legBetween(x, to)]);
    }

    let journeys = rank(candidates);

    // Two changes: run whenever there is no direct bus (Phase 3: removed the
    // `journeys.length < 3` gate that could suppress valid alternatives).
    // Find X, Y where from→X, X→Y, Y→to are all forward-reachable.
    if (direct.length === 0) {
      for (const x of fromReach.keys()) {
        if (x === to) continue;
        const xReach = reach(x);
        for (const y of xReach.keys()) {
          if (y === from || y === x || y === to) continue;
          const yReach = reach(y);
          if (!yReach.has(to)) continue;
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

  // Rank candidates: fewest transfers first, then fewest ride stops.
  // Phase 3: deduplication key uses the full stop-sequence path, not just
  // the first bus number, to preserve materially different alternatives.
  // WP1: cost removed from public output; _cost used only for internal
  // deduplication tie-break (same path → same cost, so this is a no-op
  // in practice, but kept for safety). _cost stripped before returning.
  function rank(candidates) {
    const best = new Map();
    for (const legs of candidates) {
      if (hasPointlessChange(legs)) continue;
      const journey = makeJourney(legs);
      // Key: each leg's full ordered stop list joined
      // This uniquely identifies the route taken, regardless of bus grouping
      const key = journey.legs
        .map((leg) => leg.stops.join("|"))
        .join(">");
      if (!best.has(key) || journey._cost < best.get(key)._cost)
        best.set(key, journey);
    }
    return [...best.values()]
      .sort(
        (a, b) =>
          a.changes - b.changes || // fewer transfers first (primary)
          a.rides - b.rides ||     // fewer stops (secondary)
          a.legs[0].buses[0].localeCompare(b.legs[0].buses[0]), // stable tie-break
      )
      .slice(0, MAX_RESULTS)
      .map(({ _cost, ...journey }) => journey); // strip internal _cost field
  }

  // ---------------------------------------------------------------------------
  // Plain lookups
  // ---------------------------------------------------------------------------
  const describe = ({ id, number, confidence, evidence, note, stops }) => ({
    id,
    number,
    from: stops[0],
    to: stops[stops.length - 1],
    confidence,
    evidence: evidence || null,
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

module.exports = { createPlanner, normalize, EVIDENCE_STATUSES };
