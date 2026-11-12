/**
 * Validate the legacy runtime format in data/busData.json.
 * The direction-aware migration baseline has a separate format and is not
 * validated or loaded by the application.
 */
"use strict";

const { normalize } = require("./planner");

const VALID_EVIDENCE_STATUSES = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
  "CONFLICTING",
  "HISTORICAL",
  "UNKNOWN",
];

const EVIDENCE_DIMENSIONS = [
  "endpoints",
  "stopSequence",
  "direction",
  "currentOperation",
];

const VALID_CONFIDENCE = ["high", "medium", "low"];

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validate parsed legacy runtime data. Errors are returned instead of thrown
 * so startup and tests can display every correctable issue at once.
 */
function validateDataset(data) {
  const errors = [];
  if (!isPlainObject(data)) {
    return { valid: false, errors: ["data must be a plain object"] };
  }
  if (!isCalendarDate(data.updated)) {
    errors.push('data.updated must be a valid "YYYY-MM-DD" date');
  }
  if (!Array.isArray(data.buses) || data.buses.length === 0) {
    errors.push("data.buses must be a non-empty array");
  }
  if (!isPlainObject(data.aliases)) {
    errors.push("data.aliases must be a plain object");
  }
  if (!Array.isArray(data.buses) || !isPlainObject(data.aliases)) {
    return { valid: false, errors };
  }

  const stopSet = new Set();
  const normalizedStops = new Map();
  const seenIds = new Map();
  const seenNumbers = new Map();

  for (let i = 0; i < data.buses.length; i++) {
    const bus = data.buses[i];
    const prefix = `buses[${i}]`;
    if (!isPlainObject(bus)) {
      errors.push(`${prefix} must be a plain object`);
      continue;
    }

    const label = `${prefix} (${typeof bus.number === "string" ? bus.number : "??"})`;
    if (!Number.isSafeInteger(bus.id) || bus.id < 1) {
      errors.push(`${label}: id must be a positive safe integer`);
    } else if (seenIds.has(bus.id)) {
      errors.push(`${label}: id ${bus.id} duplicates buses[${seenIds.get(bus.id)}]`);
    } else {
      seenIds.set(bus.id, i);
    }

    if (typeof bus.number !== "string" || !bus.number.trim()) {
      errors.push(`${label}: number must be a non-empty string`);
    } else {
      if (bus.number !== bus.number.trim()) {
        errors.push(`${label}: number must not have surrounding whitespace`);
      }
      const numberKey = bus.number.trim().toUpperCase();
      if (seenNumbers.has(numberKey)) {
        errors.push(
          `${label}: number "${bus.number}" duplicates buses[${seenNumbers.get(numberKey)}] after normalization`,
        );
      } else {
        seenNumbers.set(numberKey, i);
      }
    }

    if (!VALID_CONFIDENCE.includes(bus.confidence)) {
      errors.push(`${label}: confidence must be one of ${VALID_CONFIDENCE.join("|")}`);
    }

    if (!Array.isArray(bus.stops) || bus.stops.length < 2) {
      errors.push(`${label}: stops must be an array with at least 2 entries`);
    } else {
      const seenStops = new Set();
      for (let j = 0; j < bus.stops.length; j++) {
        const stop = bus.stops[j];
        if (typeof stop !== "string" || !stop.trim()) {
          errors.push(`${label}: stops[${j}] must be a non-empty string`);
          continue;
        }
        if (stop !== stop.trim()) {
          errors.push(`${label}: stop "${stop}" has surrounding whitespace`);
        }
        if (seenStops.has(stop)) {
          errors.push(`${label}: stop "${stop}" appears more than once`);
        }
        seenStops.add(stop);
        stopSet.add(stop);

        const normalized = normalize(stop);
        if (!normalized) {
          errors.push(`${label}: stop "${stop}" has an empty normalized name`);
        } else if (
          normalizedStops.has(normalized) &&
          normalizedStops.get(normalized) !== stop
        ) {
          errors.push(
            `stop names "${normalizedStops.get(normalized)}" and "${stop}" collide after normalization`,
          );
        } else {
          normalizedStops.set(normalized, stop);
        }
      }
    }

    if (!isPlainObject(bus.evidence)) {
      errors.push(`${label}: evidence must be a plain object`);
      continue;
    }
    for (const dimension of EVIDENCE_DIMENSIONS) {
      const status = bus.evidence[dimension];
      if (!VALID_EVIDENCE_STATUSES.includes(status)) {
        errors.push(
          `${label}: evidence.${dimension} must be one of ${VALID_EVIDENCE_STATUSES.join(", ")}`,
        );
      } else if (status === "VERIFIED") {
        errors.push(
          `${label}: evidence.${dimension} claims VERIFIED but the legacy runtime dataset has no per-claim source reference`,
        );
      }
    }
    if (
      ["high", "medium"].includes(bus.confidence) &&
      ["UNVERIFIED", "UNKNOWN"].includes(bus.evidence.endpoints)
    ) {
      errors.push(
        `${label}: legacy ${bus.confidence} endpoint confidence conflicts with evidence.endpoints="${bus.evidence.endpoints}"`,
      );
    }
  }

  const normalizedAliases = new Map();
  for (const [alias, target] of Object.entries(data.aliases)) {
    if (!alias.trim()) {
      errors.push("alias keys must be non-empty strings");
      continue;
    }
    if (typeof target !== "string" || !target.trim()) {
      errors.push(`alias "${alias}": target must be a non-empty string`);
      continue;
    }
    if (!stopSet.has(target)) {
      errors.push(`alias "${alias}" points to unknown stop "${target}"`);
      continue;
    }

    const normalized = normalize(alias);
    if (!normalized) {
      errors.push(`alias "${alias}" has an empty normalized name`);
      continue;
    }
    const canonicalTarget = normalizedStops.get(normalized);
    if (canonicalTarget && canonicalTarget !== target) {
      errors.push(
        `alias "${alias}" collides with canonical stop "${canonicalTarget}" but targets "${target}"`,
      );
    }
    if (
      normalizedAliases.has(normalized) &&
      normalizedAliases.get(normalized) !== target
    ) {
      errors.push(
        `aliases normalize to "${normalized}" but target different stops`,
      );
    } else {
      normalizedAliases.set(normalized, target);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateDataset,
  VALID_EVIDENCE_STATUSES,
  EVIDENCE_DIMENSIONS,
};
