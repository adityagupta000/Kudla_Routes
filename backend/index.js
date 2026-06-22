const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, "frontend")));

const dataFilePath = path.join(__dirname, "data", "busData.json");
const busData = JSON.parse(fs.readFileSync(dataFilePath, "utf8"));

const normalizeStop = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");

const buildStopIndex = (data) => {
  const index = new Map();
  data.forEach((bus) => {
    bus.routes.forEach((stop) => {
      const normalized = normalizeStop(stop);
      if (normalized && !index.has(normalized)) {
        index.set(normalized, stop.trim());
      }
    });
  });
  return index;
};

const stopIndex = buildStopIndex(busData);
const stopOptions = Array.from(stopIndex.entries()).map(
  ([normalized, display]) => ({ normalized, display }),
);

const preparedBusData = busData.map((bus) => ({
  ...bus,
  normalizedRoutes: bus.routes.map(normalizeStop),
}));

const findDirectSegments = (bus, startKey, endKey) => {
  const startIndexes = [];
  const endIndexes = [];

  bus.normalizedRoutes.forEach((stop, index) => {
    if (stop === startKey) {
      startIndexes.push(index);
    }
    if (stop === endKey) {
      endIndexes.push(index);
    }
  });

  if (startIndexes.length === 0 || endIndexes.length === 0) {
    return [];
  }

  let bestForward = null;
  let bestReverse = null;

  startIndexes.forEach((startIndex) => {
    endIndexes.forEach((endIndex) => {
      if (startIndex < endIndex) {
        const distance = endIndex - startIndex;
        if (!bestForward || distance < bestForward.distance) {
          bestForward = { startIndex, endIndex, distance };
        }
      } else if (startIndex > endIndex) {
        const distance = startIndex - endIndex;
        if (!bestReverse || distance < bestReverse.distance) {
          bestReverse = { startIndex, endIndex, distance };
        }
      }
    });
  });

  const segments = [];
  if (bestForward) {
    segments.push({
      direction: "forward",
      route: bus.routes.slice(bestForward.startIndex, bestForward.endIndex + 1),
    });
  }
  if (bestReverse) {
    segments.push({
      direction: "reverse",
      route: bus.routes
        .slice(bestReverse.endIndex, bestReverse.startIndex + 1)
        .reverse(),
    });
  }

  return segments;
};

const edgeKey = (a, b) => (a < b ? `${a}||${b}` : `${b}||${a}`);

const buildGraph = (data) => {
  const adjacency = new Map();
  const edgeBuses = new Map();

  const addNode = (node) => {
    if (!adjacency.has(node)) {
      adjacency.set(node, new Set());
    }
  };

  const addEdge = (from, to, busNumber) => {
    if (!from || !to) return;
    addNode(from);
    addNode(to);
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);

    const key = edgeKey(from, to);
    if (!edgeBuses.has(key)) {
      edgeBuses.set(key, new Set());
    }
    edgeBuses.get(key).add(busNumber.trim());
  };

  data.forEach((bus) => {
    const normalizedRoutes = bus.routes.map(normalizeStop);
    for (let i = 0; i < normalizedRoutes.length - 1; i += 1) {
      addEdge(normalizedRoutes[i], normalizedRoutes[i + 1], bus.busNumber);
    }
  });

  return { adjacency, edgeBuses };
};

const { adjacency, edgeBuses } = buildGraph(busData);

const findShortestPath = (graph, start, end) => {
  if (!graph.has(start) || !graph.has(end)) {
    return null;
  }

  const queue = [start];
  const visited = new Set([start]);
  const previous = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === end) break;

    const neighbors = graph.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  if (!visited.has(end)) {
    return null;
  }

  const path = [];
  let node = end;
  while (node) {
    path.unshift(node);
    if (node === start) break;
    node = previous.get(node);
  }

  return path[0] === start ? path : null;
};

const buildAlternativeRoute = (path) => {
  if (!path || path.length < 2) return null;

  const getCommonBuses = (edgeSlice) => {
    if (!edgeSlice.length) return [];
    let common = new Set(edgeSlice[0].buses);
    for (let i = 1; i < edgeSlice.length; i += 1) {
      common = new Set(edgeSlice[i].buses.filter((bus) => common.has(bus)));
    }
    return Array.from(common).sort();
  };

  const edges = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const fromKey = path[i];
    const toKey = path[i + 1];
    const buses = edgeBuses.get(edgeKey(fromKey, toKey));
    if (!buses || buses.size === 0) {
      return null;
    }
    edges.push({ fromKey, toKey, buses: Array.from(buses).sort() });
  }

  const backPointers = [];
  let previous = new Map();
  edges[0].buses.forEach((bus) => {
    previous.set(bus, { cost: 0 });
  });
  backPointers[0] = new Map();
  edges[0].buses.forEach((bus) => backPointers[0].set(bus, null));

  for (let i = 1; i < edges.length; i += 1) {
    const current = new Map();
    const backMap = new Map();

    let bestPrevBus = null;
    let bestPrevCost = Infinity;
    previous.forEach((info, bus) => {
      if (
        info.cost < bestPrevCost ||
        (info.cost === bestPrevCost && bus < bestPrevBus)
      ) {
        bestPrevCost = info.cost;
        bestPrevBus = bus;
      }
    });

    edges[i].buses.forEach((bus) => {
      let chosenCost = Infinity;
      let chosenPrev = null;

      if (previous.has(bus)) {
        chosenCost = previous.get(bus).cost;
        chosenPrev = bus;
      }

      const switchCost = bestPrevCost + 1;
      if (
        switchCost < chosenCost ||
        (switchCost === chosenCost &&
          bestPrevBus &&
          bestPrevBus < (chosenPrev || ""))
      ) {
        chosenCost = switchCost;
        chosenPrev = bestPrevBus;
      }

      current.set(bus, { cost: chosenCost });
      backMap.set(bus, chosenPrev);
    });

    previous = current;
    backPointers[i] = backMap;
  }

  let finalBus = null;
  let finalCost = Infinity;
  previous.forEach((info, bus) => {
    if (info.cost < finalCost || (info.cost === finalCost && bus < finalBus)) {
      finalCost = info.cost;
      finalBus = bus;
    }
  });

  if (!finalBus) return null;

  const busSequence = new Array(edges.length);
  let cursorBus = finalBus;
  for (let i = edges.length - 1; i >= 0; i -= 1) {
    busSequence[i] = cursorBus;
    cursorBus = backPointers[i].get(cursorBus);
  }

  const segments = [];
  let segmentStart = 0;
  let segmentBus = busSequence[0];
  for (let i = 1; i < busSequence.length; i += 1) {
    if (busSequence[i] !== segmentBus) {
      const edgeSlice = edges.slice(segmentStart, i);
      segments.push({
        busNumber: segmentBus,
        fromKey: path[segmentStart],
        toKey: path[i],
        stopKeys: path.slice(segmentStart, i + 1),
        availableBuses: getCommonBuses(edgeSlice),
      });
      segmentStart = i;
      segmentBus = busSequence[i];
    }
  }
  const finalEdgeSlice = edges.slice(segmentStart);
  segments.push({
    busNumber: segmentBus,
    fromKey: path[segmentStart],
    toKey: path[path.length - 1],
    stopKeys: path.slice(segmentStart),
    availableBuses: getCommonBuses(finalEdgeSlice),
  });

  return {
    stops: path.map((stop) => stopIndex.get(stop) || stop),
    segments: segments.map((segment) => ({
      busNumber: segment.busNumber,
      from: stopIndex.get(segment.fromKey) || segment.fromKey,
      to: stopIndex.get(segment.toKey) || segment.toKey,
      stops: segment.stopKeys.map((stop) => stopIndex.get(stop) || stop),
      availableBuses: segment.availableBuses,
    })),
  };
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let prev = new Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev = current;
  }

  return prev[b.length];
};

const similarity = (a, b) => {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshtein(a, b) / maxLength;
};

const rankStops = (inputNormalized) =>
  stopOptions
    .map((option) => ({
      ...option,
      score: similarity(inputNormalized, option.normalized),
    }))
    .sort((a, b) => b.score - a.score);

const AUTO_MATCH_THRESHOLD = 0.82;
const AUTO_MATCH_GAP = 0.08;
const SUGGESTION_THRESHOLD = 0.62;

const resolveStop = (inputValue) => {
  const normalized = normalizeStop(inputValue);
  if (!normalized) {
    return { value: null, normalized, corrected: false, suggestions: [] };
  }

  const exact = stopIndex.get(normalized);
  if (exact) {
    return { value: exact, normalized, corrected: false, suggestions: [] };
  }

  const ranked = rankStops(normalized);
  const suggestions = ranked
    .filter((item) => item.score >= SUGGESTION_THRESHOLD)
    .slice(0, 5)
    .map((item) => item.display);

  const best = ranked[0];
  const second = ranked[1];
  const shouldAutoCorrect =
    best &&
    best.score >= AUTO_MATCH_THRESHOLD &&
    (!second || best.score - second.score >= AUTO_MATCH_GAP);

  if (shouldAutoCorrect) {
    return {
      value: best.display,
      normalized: best.normalized,
      corrected: true,
      suggestions,
    };
  }

  return { value: null, normalized, corrected: false, suggestions };
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

app.get("/bus/:busId", (req, res) => {
  const bus = busData.find((b) => b.id === parseInt(req.params.busId));
  if (bus) res.json(bus);
  else res.status(404).json({ error: "Bus not found" });
});

app.get("/route/:start/:end", (req, res) => {
  const startMatch = resolveStop(req.params.start);
  const endMatch = resolveStop(req.params.end);

  if (!startMatch.value || !endMatch.value) {
    res.status(404).json({
      error: "Unknown stop name. Please check spelling.",
      suggestions: {
        start: startMatch.value ? [] : startMatch.suggestions,
        end: endMatch.value ? [] : endMatch.suggestions,
      },
    });
    return;
  }

  const startKey = startMatch.normalized;
  const endKey = endMatch.normalized;
  const result = [];

  preparedBusData.forEach((bus) => {
    const segments = findDirectSegments(bus, startKey, endKey);
    segments.forEach((segment) => {
      result.push({
        busNumber: bus.busNumber,
        route: segment.route,
        direction: segment.direction,
      });
    });
  });

  if (result.length > 0) {
    const response = {
      routes: result,
      resolvedStops: {
        start: startMatch.value,
        end: endMatch.value,
      },
    };

    if (startMatch.corrected || endMatch.corrected) {
      response.corrections = {
        start: startMatch.corrected ? startMatch.value : null,
        end: endMatch.corrected ? endMatch.value : null,
      };
    }

    res.json(response);
    return;
  }

  const alternativePath = findShortestPath(adjacency, startKey, endKey);
  const alternativeRoute = buildAlternativeRoute(alternativePath);

  if (alternativeRoute) {
    const response = {
      routes: [],
      alternativeRoute,
      resolvedStops: {
        start: startMatch.value,
        end: endMatch.value,
      },
      info: "No direct bus covers the full trip. Suggested transfer route:",
    };

    if (startMatch.corrected || endMatch.corrected) {
      response.corrections = {
        start: startMatch.corrected ? startMatch.value : null,
        end: endMatch.corrected ? endMatch.value : null,
      };
    }

    res.json(response);
    return;
  }

  res.status(404).json({
    error: "No buses found",
    resolvedStops: {
      start: startMatch.value,
      end: endMatch.value,
    },
  });
});

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
