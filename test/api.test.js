"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { app } = require("../backend/index");

let clientId = 0;

function dispatch(url, { ip, headers = {} } = {}) {
  const req = Object.create(express.request);
  const remoteAddress = ip || `198.51.100.${(++clientId % 250) + 1}`;
  Object.assign(req, {
    method: "GET",
    url,
    originalUrl: url,
    headers: { host: "localhost", ...headers },
    socket: { remoteAddress },
    connection: { remoteAddress },
  });

  return new Promise((resolve) => {
    const responseHeaders = {};
    const finishListeners = [];
    let finished = false;
    const res = {
      statusCode: 200,
      locals: {},
      app,
      req,
      on(event, listener) {
        if (event === "finish") finishListeners.push(listener);
        return this;
      },
      set(name, value) {
        if (typeof name === "object") {
          for (const [key, item] of Object.entries(name)) {
            responseHeaders[key.toLowerCase()] = String(item);
          }
        } else {
          responseHeaders[name.toLowerCase()] = String(value);
        }
        return this;
      },
      get(name) {
        return responseHeaders[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        this.finish();
        return this;
      },
      end(body) {
        this.body = body;
        this.finish();
        return this;
      },
      finish() {
        if (finished) return;
        finished = true;
        for (const listener of finishListeners) listener();
        resolve({
          status: this.statusCode,
          body: this.body,
          headers: responseHeaders,
        });
      },
    };

    req.app = app;
    req.res = res;
    app.handle(req, res);
  });
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(response.headers["permissions-policy"], "geolocation=(), microphone=()");
}

test("GET /api/health returns the documented aggregate structure and headers", async () => {
  const response = await dispatch("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["buses", "dataVersion", "status", "stops"]);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.buses, 99);
  assert.equal(response.body.stops, 186);
  assert.match(response.body.dataVersion, /^[a-f0-9]{8}$/);
  assertSecurityHeaders(response);
  assert.equal(response.headers["cache-control"], "no-cache");
});

test("GET /api/stops returns autocomplete results and accepts an empty query", async () => {
  const response = await dispatch("/api/stops?q=surath");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.equal(response.body[0].name, "Surathkal");
  assert.ok(Number.isInteger(response.body[0].buses));
  assert.ok(response.body[0].buses > 0);
  assertSecurityHeaders(response);
  assert.equal(response.headers["cache-control"], "no-cache");

  const empty = await dispatch("/api/stops");
  assert.equal(empty.status, 200);
  assert.ok(empty.body.length > 0);
});

test("GET /api/plan returns the journey contract and validates inputs", async () => {
  const response = await dispatch("/api/plan?from=State%20Bank&to=Kunjathbail");
  assert.equal(response.status, 200);
  assert.equal(response.body.from, "State Bank");
  assert.equal(response.body.to, "Kunjathbail");
  assert.equal(response.body.corrected.from, false);
  assert.ok(Array.isArray(response.body.journeys));
  assert.ok(response.body.journeys.length > 0);
  const journey = response.body.journeys[0];
  assert.equal(journey.changes, journey.legs.length - 1);
  assert.ok(Array.isArray(journey.legs));
  assert.deepEqual(journey.legs[0].buses, ["1"]);
  assert.ok(journey.legs[0].evidence);
  assert.equal("confidence" in journey.legs[0], false);
  assertSecurityHeaders(response);
  assert.equal(response.headers["cache-control"], "no-cache");

  for (const url of [
    "/api/plan",
    "/api/plan?from=State%20Bank",
    "/api/plan?to=Lalbagh",
  ]) {
    assert.equal((await dispatch(url)).status, 400, `${url} should be rejected`);
  }
  const sameStop = await dispatch("/api/plan?from=Lalbagh&to=Lalbagh");
  assert.equal(sameStop.status, 400);
  assert.match(sameStop.body.error, /same stop/i);

  const unknown = await dispatch("/api/plan?from=unknown-stop-xyz&to=Lalbagh");
  assert.equal(unknown.status, 404);
  assert.ok(Array.isArray(unknown.body.suggestions.from));
  assert.equal(unknown.body.suggestions.to.length, 0);

  const noJourney = await dispatch("/api/plan?from=Kunjathbail&to=State%20Bank");
  assert.equal(noJourney.status, 200);
  assert.deepEqual(noJourney.body.journeys, []);
  assert.equal(noJourney.body.reverseRecorded, true);
  assert.ok(Array.isArray(noJourney.body.popularStops));
});

test("GET /api/buses and GET /api/bus/:number return public bus structures", async () => {
  const all = await dispatch("/api/buses");
  assert.equal(all.status, 200);
  assert.ok(Array.isArray(all.body));
  assert.equal(all.body.length, 99);
  assert.ok(all.body.every((bus) => !("confidence" in bus) && Array.isArray(bus.stops)));
  assertSecurityHeaders(all);
  assert.equal(all.headers["cache-control"], "no-cache");

  const single = await dispatch("/api/bus/45a");
  assert.equal(single.status, 200);
  assert.equal(single.body.number, "45A");
  assert.equal(single.body.from, "State Bank");
  assert.ok(Array.isArray(single.body.stops));
  assert.equal("confidence" in single.body, false);

  const unknown = await dispatch("/api/bus/999");
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /999/);
});

test("GET /api/stop/:name returns details or a not-found response", async () => {
  const response = await dispatch("/api/stop/Lalbagh");
  assert.equal(response.status, 200);
  assert.equal(response.body.name, "Lalbagh");
  assert.ok(Array.isArray(response.body.aliases));
  assert.ok(Array.isArray(response.body.buses));
  assert.ok(response.body.buses.length > 0);
  assert.equal(response.body.buses[0].confidence, undefined);
  assertSecurityHeaders(response);
  assert.equal(response.headers["cache-control"], "no-cache");

  const unknown = await dispatch("/api/stop/zzz_nonexistent_stop_xyz");
  assert.equal(unknown.status, 404);
  assert.ok(Array.isArray(unknown.body.suggestions));
});

test("API rejects repeated and non-string query values", async () => {
  const repeated = await dispatch("/api/plan?from=Lalbagh&from=Kadri&to=Surathkal");
  assert.equal(repeated.status, 400);
  assert.match(repeated.body.error, /must not be repeated/);

  const previousParser = app.get("query parser");
  app.set("query parser", "extended");
  try {
    const nonString = await dispatch("/api/plan?from%5Bvalue%5D=Lalbagh&to=Surathkal");
    assert.equal(nonString.status, 400);
    assert.match(nonString.body.error, /must be a string/);
  } finally {
    app.set("query parser", previousParser);
  }
});

test("malformed route encoding returns a generic error without stack details", async () => {
  const response = await dispatch("/api/stop/%E0%A4%A");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Something went wrong on the server." });
  assert.equal("stack" in response.body, false);
  assert.equal(JSON.stringify(response.body).includes(" at "), false);
});

test("API route limiters enforce the real middleware and isolate client and route buckets", async () => {
  const clientIp = "203.0.113.71";
  for (let i = 0; i < 60; i++) {
    assert.equal((await dispatch("/api/health", { ip: clientIp })).status, 200);
  }
  const limited = await dispatch("/api/health", { ip: clientIp });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
  assert.equal(limited.body.error, "Too many requests. Please slow down.");

  assert.equal((await dispatch("/api/stops", { ip: clientIp })).status, 200);
  assert.equal((await dispatch("/api/plan?from=State%20Bank&to=Kunjathbail", {
    ip: clientIp,
  })).status, 200);
  assert.equal((await dispatch("/api/health", { ip: "203.0.113.72" })).status, 200);
});

test("rate limiter keys the client IP according to Express trust-proxy settings", async () => {
  const previousTrustProxy = app.get("trust proxy");
  app.set("trust proxy", 1);
  try {
    const headers = { "x-forwarded-for": "192.0.2.140" };
    for (let i = 0; i < 60; i++) {
      assert.equal((await dispatch("/api/health", {
        ip: "127.0.0.1",
        headers,
      })).status, 200);
    }
    assert.equal((await dispatch("/api/health", {
      ip: "127.0.0.1",
      headers,
    })).status, 429);
    assert.equal((await dispatch("/api/health", {
      ip: "127.0.0.1",
      headers: { "x-forwarded-for": "192.0.2.141" },
    })).status, 200);
  } finally {
    app.set("trust proxy", previousTrustProxy);
  }
});

test("unmatched API routes return a JSON 404", async () => {
  const response = await dispatch("/api/not-a-route");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Not found." });
});
