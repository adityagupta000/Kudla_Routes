"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  DATA_PATH,
  REPORT_DATASET_NAME,
  buildReport,
} = require("../data/scripts/direction-aware-report");

test("direction-aware report identifies its dataset and hashes exact file bytes", () => {
  const bytes = fs.readFileSync(DATA_PATH);
  const report = buildReport(bytes);
  assert.equal(report.file, REPORT_DATASET_NAME);
  assert.match(report.dataset_role, /not runtime data/);
  assert.equal(report.bytes, bytes.length);
  assert.equal(
    report.sha256,
    crypto.createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(report.structurally_valid, true, report.errors.join("\n"));
  assert.deepEqual(
    {
      routes: report.routes,
      stops: report.stops,
      aliases: report.aliases,
      listed_patterns: report.listed_patterns,
      verified_patterns: report.verified_patterns,
      reverse_patterns: report.reverse_patterns,
      service_notices: report.service_notices,
    },
    {
      routes: 99,
      stops: 186,
      aliases: 36,
      listed_patterns: 99,
      verified_patterns: 0,
      reverse_patterns: 0,
      service_notices: 1,
    },
  );
  assert.match(report.factual_verification, /does not prove/);
});

test("direction-aware structural report detects inconsistent pattern endpoints", () => {
  const bytes = fs.readFileSync(DATA_PATH);
  const data = JSON.parse(bytes.toString("utf8"));
  data.routes[0].patterns[0].destination_stop_id = "stop-not-in-sequence";
  const report = buildReport(Buffer.from(JSON.stringify(data)));
  assert.equal(report.structurally_valid, false);
  assert.ok(report.errors.some((error) => error.includes("destination_stop_id")));
});
