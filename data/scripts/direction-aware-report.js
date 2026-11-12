#!/usr/bin/env node
/**
 * Regenerate the structural report for the direction-aware research baseline.
 * This tool is separate from report.js and backend/validate.js, which operate
 * only on the legacy runtime dataset.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_PATH = path.resolve(__dirname, "../kudla-route-data.json");
const REPORT_PATH = path.resolve(__dirname, "../KUDLA_DATASET_VALIDATION.json");
const REPORT_DATASET_NAME = "data/kudla-route-data.json";
const FACTUAL_LIMITATION =
  "Structural consistency only; it does not prove route sequence, direction, current operation, or other real-world facts.";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getCounts(data) {
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  const stops = Array.isArray(data?.stops) ? data.stops : [];
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const aliases = isPlainObject(data?.aliases) ? data.aliases : {};
  const serviceNotices = Array.isArray(data?.service_notices)
    ? data.service_notices
    : [];
  const patterns = routes.flatMap((route) =>
    Array.isArray(route?.patterns) ? route.patterns : [],
  );
  const reversed = patterns.filter((pattern) =>
    pattern &&
    ["reverse", "return"].includes(String(pattern.direction_type).toLowerCase()),
  );
  const verifiedReverseRouteIds = new Set(
    reversed
      .filter((pattern) => pattern?.verification_status === "verified")
      .map((pattern) => pattern.route_id),
  );
  const sourceTypes = new Map(sources.map((source) => [
    source?.source_id,
    source?.source_type,
  ]));
  const operatorVerified = patterns.filter(
    (pattern) =>
      pattern?.verification_status === "verified" &&
      Array.isArray(pattern.source_ids) && pattern.source_ids.some((sourceId) =>
        /operator|official_primary/i.test(sourceTypes.get(sourceId) || ""),
      ),
  );

  return {
    routes: routes.length,
    stops: stops.length,
    aliases: Object.keys(aliases).length,
    listed_patterns: patterns.length,
    verified_patterns: patterns.filter(
      (pattern) => pattern?.verification_status === "verified",
    ).length,
    reverse_patterns: reversed.length,
    service_notices: serviceNotices.length,
    route_patterns_with_verified_reverse: verifiedReverseRouteIds.size,
    route_patterns_with_operator_verified_stop_sequence: operatorVerified.length,
  };
}

function validateDirectionAwareData(data, counts) {
  const errors = [];
  if (!isPlainObject(data)) {
    return ["dataset root must be an object"];
  }
  if (!isPlainObject(data.metadata)) errors.push("metadata must be an object");
  if (!Array.isArray(data.sources)) errors.push("sources must be an array");
  if (!Array.isArray(data.stops)) errors.push("stops must be an array");
  if (!Array.isArray(data.routes)) errors.push("routes must be an array");
  if (!isPlainObject(data.aliases)) errors.push("aliases must be an object");
  if (!Array.isArray(data.service_notices)) {
    errors.push("service_notices must be an array");
  }
  if (errors.length) return errors;

  const stopIds = new Set();
  const routeIds = new Set();
  const routeNumbers = new Set();
  const sourceIds = new Set();
  const patternIds = new Set();

  for (const [index, source] of data.sources.entries()) {
    if (!isPlainObject(source) || typeof source.source_id !== "string" || !source.source_id) {
      errors.push(`sources[${index}] must have a non-empty source_id`);
    } else if (sourceIds.has(source.source_id)) {
      errors.push(`duplicate source_id "${source.source_id}"`);
    } else {
      sourceIds.add(source.source_id);
    }
  }

  for (const [index, stop] of data.stops.entries()) {
    if (!isPlainObject(stop)) {
      errors.push(`stops[${index}] must be an object`);
      continue;
    }
    if (typeof stop.stop_id !== "string" || !stop.stop_id) {
      errors.push(`stops[${index}] must have a non-empty stop_id`);
    } else if (stopIds.has(stop.stop_id)) {
      errors.push(`duplicate stop_id "${stop.stop_id}"`);
    } else {
      stopIds.add(stop.stop_id);
    }
    if (typeof stop.name !== "string" || !stop.name.trim()) {
      errors.push(`stops[${index}] must have a non-empty name`);
    }
  }

  for (const [index, route] of data.routes.entries()) {
    if (!isPlainObject(route)) {
      errors.push(`routes[${index}] must be an object`);
      continue;
    }
    if (typeof route.route_id !== "string" || !route.route_id) {
      errors.push(`routes[${index}] must have a non-empty route_id`);
    } else if (routeIds.has(route.route_id)) {
      errors.push(`duplicate route_id "${route.route_id}"`);
    } else {
      routeIds.add(route.route_id);
    }
    if (typeof route.route_number !== "string" || !route.route_number.trim()) {
      errors.push(`routes[${index}] must have a non-empty route_number`);
    } else {
      const number = route.route_number.trim().toUpperCase();
      if (routeNumbers.has(number)) errors.push(`duplicate route_number "${route.route_number}"`);
      routeNumbers.add(number);
    }
    if (!Array.isArray(route.patterns)) {
      errors.push(`routes[${index}].patterns must be an array`);
      continue;
    }
    for (const [patternIndex, pattern] of route.patterns.entries()) {
      const label = `routes[${index}].patterns[${patternIndex}]`;
      if (!isPlainObject(pattern)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      if (typeof pattern.pattern_id !== "string" || !pattern.pattern_id) {
        errors.push(`${label} must have a non-empty pattern_id`);
      } else if (patternIds.has(pattern.pattern_id)) {
        errors.push(`duplicate pattern_id "${pattern.pattern_id}"`);
      } else {
        patternIds.add(pattern.pattern_id);
      }
      if (
        !Array.isArray(pattern.stop_sequence) ||
        pattern.stop_sequence.length < 2
      ) {
        errors.push(`${label}.stop_sequence must contain at least 2 stop IDs`);
        continue;
      }
      if (new Set(pattern.stop_sequence).size !== pattern.stop_sequence.length) {
        errors.push(`${label}.stop_sequence contains duplicate stop IDs`);
      }
      for (const stopId of pattern.stop_sequence) {
        if (!stopIds.has(stopId)) errors.push(`${label} references unknown stop "${stopId}"`);
      }
      if (pattern.origin_stop_id !== pattern.stop_sequence[0]) {
        errors.push(`${label}.origin_stop_id must match the first stop_sequence entry`);
      }
      if (pattern.destination_stop_id !== pattern.stop_sequence.at(-1)) {
        errors.push(`${label}.destination_stop_id must match the last stop_sequence entry`);
      }
      if (!Array.isArray(pattern.source_ids)) {
        errors.push(`${label}.source_ids must be an array`);
      } else {
        for (const sourceId of pattern.source_ids) {
          if (!sourceIds.has(sourceId)) errors.push(`${label} references unknown source "${sourceId}"`);
        }
      }
    }
  }

  for (const [index, stop] of data.stops.entries()) {
    if (!isPlainObject(stop)) continue;
    if (!Array.isArray(stop.served_by_route_ids)) {
      errors.push(`stops[${index}].served_by_route_ids must be an array`);
      continue;
    }
    for (const routeId of stop.served_by_route_ids) {
      if (!routeIds.has(routeId)) {
        errors.push(`stops[${index}] references unknown route "${routeId}"`);
      }
    }
  }

  for (const [alias, stopId] of Object.entries(data.aliases)) {
    if (typeof stopId !== "string" || !stopIds.has(stopId)) {
      errors.push(`alias "${alias}" references unknown stop ID "${stopId}"`);
    }
  }

  const metadataCounts = data.metadata.counts;
  if (!isPlainObject(metadataCounts)) {
    errors.push("metadata.counts must be an object");
  } else {
    for (const field of [
      "route_records",
      "listed_direction_patterns",
      "canonical_stop_records",
      "legacy_aliases",
      "route_patterns_with_verified_reverse",
      "route_patterns_with_operator_verified_stop_sequence",
    ]) {
      const actual = {
        route_records: counts.routes,
        listed_direction_patterns: counts.listed_patterns,
        canonical_stop_records: counts.stops,
        legacy_aliases: counts.aliases,
        route_patterns_with_verified_reverse: counts.route_patterns_with_verified_reverse,
        route_patterns_with_operator_verified_stop_sequence:
          counts.route_patterns_with_operator_verified_stop_sequence,
      }[field];
      if (metadataCounts[field] !== actual) {
        errors.push(`metadata.counts.${field} is ${metadataCounts[field]}, expected ${actual}`);
      }
    }
  }

  return errors;
}

function buildReport(bytes, datasetPath = REPORT_DATASET_NAME) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const data = JSON.parse(raw.toString("utf8"));
  const counts = getCounts(data);
  const errors = validateDirectionAwareData(data, counts);
  return {
    file: datasetPath,
    dataset_role: "direction-aware research/migration baseline; not runtime data",
    bytes: raw.length,
    ...counts,
    structurally_valid: errors.length === 0,
    errors,
    factual_verification: FACTUAL_LIMITATION,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

function main() {
  const bytes = fs.readFileSync(DATA_PATH);
  const report = buildReport(bytes);
  const temporaryPath = `${REPORT_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
    fs.renameSync(temporaryPath, REPORT_PATH);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }

  console.log(`Dataset: ${report.file} (${report.dataset_role})`);
  console.log(`Bytes: ${report.bytes}`);
  console.log(`SHA-256: ${report.sha256}`);
  console.log(
    `Counts: ${report.routes} routes, ${report.stops} stops, ${report.aliases} aliases, ${report.listed_patterns} patterns`,
  );
  console.log(`Structural validation: ${report.structurally_valid ? "valid" : "INVALID"}`);
  console.log(`Factual limitation: ${report.factual_verification}`);
  for (const error of report.errors) console.error(`- ${error}`);
  if (!report.structurally_valid) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DATA_PATH,
  REPORT_PATH,
  REPORT_DATASET_NAME,
  buildReport,
  getCounts,
  validateDirectionAwareData,
};
