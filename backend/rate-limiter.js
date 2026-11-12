"use strict";

function createRateLimiter({ clock = Date.now, cleanupIntervalMs = 300000 } = {}) {
  const records = new Map();
  let nextScope = 0;

  function cleanupExpired() {
    const now = clock();
    let removed = 0;
    for (const [key, record] of records) {
      if (now - record.start >= record.window * 2) {
        records.delete(key);
        removed++;
      }
    }
    return removed;
  }

  const cleanupTimer = cleanupIntervalMs > 0
    ? setInterval(cleanupExpired, cleanupIntervalMs).unref()
    : null;

  function makeRateLimiter(max, windowMs, scope = `limiter-${nextScope++}`) {
    return function rateLimiter(req, res, next) {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const key = `${scope}:${ip}`;
      const now = clock();
      let record = records.get(key);
      if (!record || now - record.start >= windowMs) {
        record = { count: 0, start: now, window: windowMs };
        records.set(key, record);
      }
      record.count += 1;
      if (record.count > max) {
        const retryAfterMs = windowMs - (now - record.start);
        res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
        return res.status(429).json({
          error: "Too many requests. Please slow down.",
          retryAfterMs,
        });
      }
      next();
    };
  }

  return {
    makeRateLimiter,
    cleanupExpired,
    close() {
      if (cleanupTimer) clearInterval(cleanupTimer);
    },
  };
}

module.exports = { createRateLimiter };
