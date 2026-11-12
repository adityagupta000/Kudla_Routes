/**
 * Mangalore bus finder — web server.
 * Serves the frontend and a small read-only JSON API. All route logic is in planner.js.
 *
 * WP3: API contract cleanup —
 *   - confidence removed from leg, bus, and stop-detail outputs (use evidence instead)
 *   - no-result response is HTTP 200 with journeys:[] + reverseRecorded flag
 *   - non-string / repeated query parameters rejected with 400
 *   - Cache-Control headers on static and API responses
 *   - dataVersion (SHA-1 prefix) added to /api/health
 *
 * WP5: Security and privacy —
 *   - TRUST_PROXY env var: set app.set("trust proxy", ...) when configured
 *   - Per-route rate limits: /api/plan 30/min, /api/stops 120/min, rest 60/min
 *   - Retry-After header on 429 responses
 *   - Request logging: method, path (no query string), status, duration only
 *   - Log method, path (no query string), status, duration — never stop names
 */
"use strict";

const express = require("express");
const path    = require("path");
const crypto  = require("crypto");
const { createPlanner } = require("./planner");
const { validateDataset } = require("./validate");
const { createRateLimiter } = require("./rate-limiter");

// ---------------------------------------------------------------------------
// Load and validate data (WP2: shared validateDataset)
// ---------------------------------------------------------------------------
let data;
try {
  data = require("../data/busData.json");
} catch (err) {
  console.error("Fatal: failed to load bus data:", err.message);
  process.exit(1);
}

const validation = validateDataset(data);
if (!validation.valid) {
  console.error("Fatal: bus data failed validation:");
  for (const err of validation.errors) console.error("  -", err);
  process.exit(1);
}

// Stable hash of the dataset file — exposed in /api/health as dataVersion.
// Computed once at startup; changes if the file content changes.
const DATA_VERSION = crypto
  .createHash("sha1")
  .update(JSON.stringify(data))
  .digest("hex")
  .slice(0, 8);

const planner = createPlanner(data);

console.log(`Data loaded: ${data.buses.length} buses, ${planner.stopCount} stops (v${DATA_VERSION})`);

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");

// ---------------------------------------------------------------------------
// WP5: TRUST_PROXY — set if the app runs behind a reverse proxy.
// Valid values in .env: "false" (default), "1", "loopback".
// Without this, rate limiting keys on the proxy's IP (everyone shares one bucket).
// ---------------------------------------------------------------------------
const trustProxyEnv = (process.env.TRUST_PROXY || "false").trim().toLowerCase();
if (trustProxyEnv === "1") {
  app.set("trust proxy", 1);
  console.log("Trust proxy: 1 (first hop)");
} else if (trustProxyEnv === "loopback") {
  app.set("trust proxy", "loopback");
  console.log("Trust proxy: loopback");
} else if (trustProxyEnv !== "false") {
  console.warn(`Unknown TRUST_PROXY value "${trustProxyEnv}"; defaulting to off.`);
}

// ---------------------------------------------------------------------------
// Request logging — method, safe route label, status, duration.
// Issue 3 fix: req.path exposes stop names (e.g. GET /api/stop/Lalbagh).
// Replace dynamic path segments with their route template so no user-supplied
// value ever appears in the log.
// ---------------------------------------------------------------------------
const ROUTE_TEMPLATES = [
  [/^\/api\/plan$/,       "GET /api/plan"],
  [/^\/api\/stops$/,      "GET /api/stops"],
  [/^\/api\/health$/,     "GET /api/health"],
  [/^\/api\/buses$/,      "GET /api/buses"],
  [/^\/api\/bus\/[^/]+$/, "GET /api/bus/:number"],
  [/^\/api\/stop\/[^/]+$/,"GET /api/stop/:name"],
  [/^\/api\//,            "GET /api/*"],
];

function safeRouteLabel(method, pathname) {
  for (const [pattern, label] of ROUTE_TEMPLATES) {
    if (pattern.test(pathname)) return `${method} ${label.slice(label.indexOf(" ") + 1)}`;
  }
  // Non-API paths: static files. Log method + fixed label; never the filename.
  if (!pathname.startsWith("/api/")) return `${method} /static`;
  return `${method} /api/*`;
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${safeRouteLabel(req.method, req.path)} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// ---------------------------------------------------------------------------
// WP5: Per-route rate limiting — in-memory, single-instance only. No Redis.
//   /api/plan:    30 requests/min  (planning calls are expensive)
//   /api/stops:  120 requests/min  (autocomplete is lightweight)
//   all other /api: 60 requests/min
// Retry-After header is set on 429 responses (seconds until window resets).
// ---------------------------------------------------------------------------
const { makeRateLimiter } = createRateLimiter();

const planLimiter  = makeRateLimiter(30,  60000);  // 30/min for /api/plan
const stopsLimiter = makeRateLimiter(120, 60000);  // 120/min for /api/stops
const apiLimiter   = makeRateLimiter(60,  60000);  // 60/min for everything else

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options":        "DENY",
    "Referrer-Policy":        "no-referrer",
    // WP4-F5: style-src 'self' — app.js uses el.style.setProperty(), never setAttribute("style")
    // favicon.svg served from same origin as a file — no data: URI needed
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'",
    "Permissions-Policy": "geolocation=(), microphone=()",
  });
  next();
});

// ---------------------------------------------------------------------------
// WP3: Reject non-string or repeated query parameters
// Applies to all /api routes. Must run before route handlers.
// ---------------------------------------------------------------------------
app.use("/api", (req, res, next) => {
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      return res.status(400).json({
        error: `Query parameter "${key}" must not be repeated.`,
      });
    }
    if (typeof value !== "string") {
      return res.status(400).json({
        error: `Query parameter "${key}" must be a string.`,
      });
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Static files — no-cache for HTML/JS (always revalidate), 1h for fonts/CSS
// WP3: HTML and JS get Cache-Control: no-cache + ETag so browsers revalidate.
// Fonts/CSS are immutable-ish; 1 hour is acceptable.
// ---------------------------------------------------------------------------
app.use(
  express.static(path.join(__dirname, "../frontend"), {
    etag:         true,
    lastModified: true,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".html" || ext === ".js") {
        // Always revalidate; ETag lets the browser avoid re-downloading if unchanged
        res.set("Cache-Control", "no-cache");
      } else if (ext === ".woff2" || ext === ".woff" || ext === ".css" || ext === ".svg") {
        // Fonts/CSS/SVG: 1-hour cache (short enough to pick up updates reasonably quickly)
        res.set("Cache-Control", "public, max-age=3600");
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Sanitize and length-limit a query string value
const clean = (value) =>
  String(value ?? "")
    .trim()
    .slice(0, 60);

// WP3: Strip legacy confidence field from a bus object before sending.
// Callers that need evidence use leg.evidence / bus.evidence directly.
// confidence stays in the dataset (it drives evidence parity tests) but
// is not part of the public API contract.
const stripLegacy = ({ confidence, ...rest }) => rest;

// WP3: Shape a bus for external output — evidence kept, confidence removed.
const describeBusPublic = (bus) => {
  const { confidence, ...rest } = bus; // remove confidence from API surface
  return rest;
};

// ---------------------------------------------------------------------------
// /api/health — aggregate stats only; no stop names, no query values in log
// ---------------------------------------------------------------------------
app.get("/api/health", apiLimiter, (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json({
    status:      "ok",
    stops:       planner.stopCount,
    buses:       planner.listBuses().length,
    dataVersion: DATA_VERSION,  // WP3: dataset hash for verification
  });
});

// ---------------------------------------------------------------------------
// /api/stops — autocomplete (higher rate limit — lightweight)
// ---------------------------------------------------------------------------
app.get("/api/stops", stopsLimiter, (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json(
    planner
      .search(clean(req.query.q))
      .map(({ stop, buses }) => ({ name: stop, buses })),
  );
});

// ---------------------------------------------------------------------------
// /api/plan — the main question: how do I get from A to B?
//
// WP3 changes:
//   - no-result is 200 with journeys:[] (not mixed with 404)
//   - reverseRecorded: true when plan(to, from) has results
//     Worded as "a route from Y to X is recorded" per amendment 3
//   - confidence stripped from legs (evidence field carries the information)
// ---------------------------------------------------------------------------
app.get("/api/plan", planLimiter, (req, res) => {
  res.set("Cache-Control", "no-cache");

  const fromText = clean(req.query.from);
  const toText   = clean(req.query.to);
  if (!fromText || !toText) {
    return res
      .status(400)
      .json({ error: "Enter a starting stop and a destination." });
  }

  const from = planner.resolve(fromText);
  const to   = planner.resolve(toText);
  if (!from.stop || !to.stop) {
    const unknown = [
      !from.stop && `"${fromText}"`,
      !to.stop   && `"${toText}"`,
    ].filter(Boolean);
    return res.status(404).json({
      error: `No stop found for ${unknown.join(" or ")}.`,
      suggestions: { from: from.suggestions || [], to: to.suggestions || [] },
    });
  }
  if (from.stop === to.stop) {
    return res
      .status(400)
      .json({ error: "Your start and destination are the same stop." });
  }

  const journeys = planner.plan(from.stop, to.stop);

  // Strip legacy confidence from each leg (evidence object carries the info)
  const cleanJourneys = journeys.map((journey) => ({
    ...journey,
    legs: journey.legs.map(stripLegacy),
  }));

  const response = {
    from:      from.stop,
    to:        to.stop,
    corrected: { from: from.corrected, to: to.corrected },
    journeys:  cleanJourneys,
  };

  if (cleanJourneys.length === 0) {
    // Check if the reverse direction has results within the same 2-change limit.
    // Note: reverseRecorded:false does NOT prove no connection exists — it means
    // no route was found within 2 changes in either direction.
    const reverseJourneys = planner.plan(to.stop, from.stop);
    response.reverseRecorded = reverseJourneys.length > 0;
    // popularStops: busiest stops by bus count — NOT geographically nearby stops.
    // The dataset has no coordinates; proximity cannot be determined.
    response.popularStops = planner.busiestStops();
  }

  res.json(response);
});

// ---------------------------------------------------------------------------
// /api/buses — all buses; confidence removed (WP3), evidence kept
// ---------------------------------------------------------------------------
app.get("/api/buses", apiLimiter, (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json(planner.listBuses().map(describeBusPublic));
});

// ---------------------------------------------------------------------------
// /api/bus/:number — single bus; confidence removed (WP3), evidence kept
// ---------------------------------------------------------------------------
app.get("/api/bus/:number", apiLimiter, (req, res) => {
  res.set("Cache-Control", "no-cache");
  const bus = planner.getBus(req.params.number);
  if (!bus)
    return res
      .status(404)
      .json({ error: `No bus numbered ${req.params.number}.` });
  res.json(describeBusPublic(bus));
});

// ---------------------------------------------------------------------------
// /api/stop/:name — stop detail; confidence removed (WP3), evidence kept.
// Issue 1 fix: use planner.resolve() instead of raw search() so ambiguous
// names return suggestions rather than silently picking the first fuzzy hit.
// ---------------------------------------------------------------------------
app.get("/api/stop/:name", apiLimiter, (req, res) => {
  res.set("Cache-Control", "no-cache");
  const name = clean(req.params.name);
  const resolved = planner.resolve(name);
  if (!resolved.stop) {
    return res.status(404).json({
      error: `No stop found for "${name}".`,
      suggestions: resolved.suggestions || [],
    });
  }
  const stopName = resolved.stop;
  const aliases = Object.entries(data.aliases || {})
    .filter(([, target]) => target === stopName)
    .map(([alias]) => alias);
  // WP3: confidence removed from buses-at-stop; evidence kept
  const busesAtStop = planner
    .listBuses()
    .filter((b) => b.stops.includes(stopName))
    .map(({ number, evidence, from, to }) => ({ number, evidence, from, to }));
  res.json({
    name:    stopName,
    aliases,
    buses:   busesAtStop,
    note:    "Service availability and schedules are not guaranteed. Direction patterns are as stored; return directions have not been independently verified.",
  });
});

// ---------------------------------------------------------------------------
// 404 for unmatched /api/* routes
// ---------------------------------------------------------------------------
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Error handler — no stack traces in responses
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

// ---------------------------------------------------------------------------
// Start server (only when run directly, not when required by tests)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const port   = process.env.PORT || 3000;
  const server = app.listen(port, () =>
    console.log(`Bus finder running at http://localhost:${port}`),
  );
  // WP7: forced-exit timeout after SIGTERM so long requests don't stall deploys
  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down gracefully`);
    server.close(() => process.exit(0));
    setTimeout(() => {
      console.log("Forced exit after 5s drain timeout");
      process.exit(1);
    }, 5000).unref();
  };
  process.on("SIGTERM", shutdown.bind(null, "SIGTERM"));
  process.on("SIGINT",  shutdown.bind(null, "SIGINT"));
}

module.exports = { app, planner, safeRouteLabel };
