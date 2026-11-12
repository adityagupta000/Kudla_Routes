"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../backend/rate-limiter");

function request(ip = "192.0.2.1") {
  return {
    ip,
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function response() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    set(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
  };
}

function invoke(limiter, req = request()) {
  const res = response();
  let continued = false;
  limiter(req, res, () => {
    continued = true;
  });
  return { res, continued };
}

test("production rate limiter allows the configured count and rejects the next request", () => {
  let now = 0;
  const limiter = createRateLimiter({ clock: () => now, cleanupIntervalMs: 0 });
  try {
    const allow = limiter.makeRateLimiter(2, 60000);
    assert.equal(invoke(allow).continued, true);
    assert.equal(invoke(allow).continued, true);
    const blocked = invoke(allow);
    assert.equal(blocked.continued, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.deepEqual(blocked.res.body, {
      error: "Too many requests. Please slow down.",
      retryAfterMs: 60000,
    });
    assert.equal(blocked.res.getHeader("Retry-After"), "60");
  } finally {
    limiter.close();
  }
});

test("Retry-After counts down and the window resets exactly at its boundary", () => {
  let now = 0;
  const limiter = createRateLimiter({ clock: () => now, cleanupIntervalMs: 0 });
  try {
    const allow = limiter.makeRateLimiter(1, 60000);
    invoke(allow);
    now = 5001;
    const blocked = invoke(allow);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(blocked.res.getHeader("Retry-After"), "55");
    assert.equal(blocked.res.body.retryAfterMs, 54999);

    now = 60000;
    const boundary = invoke(allow);
    assert.equal(boundary.continued, true);
    assert.equal(boundary.res.statusCode, 200);
  } finally {
    limiter.close();
  }
});

test("separates client IPs, limiter instances, and socket-address fallbacks", () => {
  let now = 0;
  const limiter = createRateLimiter({ clock: () => now, cleanupIntervalMs: 0 });
  try {
    const firstRoute = limiter.makeRateLimiter(1, 60000, "first-route");
    const secondRoute = limiter.makeRateLimiter(1, 60000, "second-route");
    assert.equal(invoke(firstRoute, request("198.51.100.1")).continued, true);
    assert.equal(invoke(firstRoute, request("198.51.100.2")).continued, true);
    assert.equal(invoke(firstRoute, request("198.51.100.1")).res.statusCode, 429);
    assert.equal(invoke(secondRoute, request("198.51.100.1")).continued, true);

    const fallbackRoute = limiter.makeRateLimiter(1, 60000, "fallback");
    assert.equal(invoke(fallbackRoute, request("")).continued, true);
    assert.equal(invoke(fallbackRoute, request("")).res.statusCode, 429);
  } finally {
    limiter.close();
  }
});

test("expired-record cleanup removes records after two full windows", () => {
  let now = 0;
  const limiter = createRateLimiter({ clock: () => now, cleanupIntervalMs: 0 });
  try {
    const allow = limiter.makeRateLimiter(1, 1000, "cleanup");
    invoke(allow, request("198.51.100.3"));
    now = 1999;
    assert.equal(limiter.cleanupExpired(), 0);

    now = 2000;
    assert.equal(limiter.cleanupExpired(), 1);
    assert.equal(invoke(allow, request("198.51.100.3")).continued, true);
  } finally {
    limiter.close();
  }
});
