#!/usr/bin/env node
/**
 * Safely prepares the legacy evidence migration for data/busData.json.
 *
 * Dry-run is the default. Use --write to create a backup and atomically replace
 * the legacy file after the migrated result passes backend/validate.js.
 * The direction-aware kudla-route-data.json is not an input to this script.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateDataset } = require("../../backend/validate");

const DATA_PATH = path.resolve(__dirname, "../busData.json");

const CONFIDENCE_TO_ENDPOINTS = {
  high: "PARTIALLY_VERIFIED",
  medium: "PARTIALLY_VERIFIED",
  low: "UNVERIFIED",
};

const EVIDENCE_DIMENSIONS = [
  "endpoints",
  "stopSequence",
  "direction",
  "currentOperation",
];

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function evidenceFor(bus) {
  if (bus.evidence !== undefined && !isPlainObject(bus.evidence)) {
    return bus.evidence;
  }

  const defaults = {
    endpoints: CONFIDENCE_TO_ENDPOINTS[bus.confidence] || "UNKNOWN",
    stopSequence: "UNKNOWN",
    direction: "UNKNOWN",
    currentOperation: "UNKNOWN",
  };
  return { ...defaults, ...(bus.evidence || {}) };
}

function summarize(data) {
  const summary = { buses: data.buses.length, dimensions: {} };
  for (const dimension of EVIDENCE_DIMENSIONS) {
    const counts = {};
    for (const bus of data.buses) {
      const status = bus.evidence?.[dimension] ?? "MISSING";
      counts[status] = (counts[status] || 0) + 1;
    }
    summary.dimensions[dimension] = counts;
  }
  return summary;
}

function prepareMigration(data) {
  if (!isPlainObject(data) || !Array.isArray(data.buses)) {
    throw new Error(
      "Input must use the legacy runtime format with a buses array; direction-aware data is not supported.",
    );
  }

  const before = summarize(data);
  const migrated = {
    ...data,
    buses: data.buses.map((bus, index) => {
      if (!isPlainObject(bus)) {
        throw new Error(`buses[${index}] must be a plain object`);
      }
      return { ...bus, evidence: evidenceFor(bus, index) };
    }),
  };
  return { data: migrated, before, after: summarize(migrated) };
}

function validateMigration(data) {
  const result = validateDataset(data);
  if (!result.valid) {
    throw new Error(
      `Migrated dataset failed validation:\n${result.errors.map((error) => `  - ${error}`).join("\n")}`,
    );
  }
}

function printSummary(log, title, summary) {
  log(`${title}: ${summary.buses} buses`);
  for (const [dimension, counts] of Object.entries(summary.dimensions)) {
    log(`  ${dimension}: ${JSON.stringify(counts)}`);
  }
}

function uniquePath(basePath, suffix) {
  let candidate = `${basePath}.${suffix}`;
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${basePath}.${suffix}.${index++}`;
  }
  return candidate;
}

function writeSafely(inputPath, content) {
  const directory = path.dirname(inputPath);
  const basename = path.basename(inputPath);
  const token = `${process.pid}.${crypto.randomUUID()}`;
  const temporaryPath = path.join(directory, `.${basename}.${token}.tmp`);
  const backupPath = uniquePath(
    inputPath,
    `bak.${new Date().toISOString().replace(/[:.]/g, "-")}.${process.pid}`,
  );
  let descriptor;
  let temporaryExists = false;

  try {
    descriptor = fs.openSync(temporaryPath, "wx");
    temporaryExists = true;
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    fs.copyFileSync(inputPath, backupPath, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporaryPath, inputPath);
    temporaryExists = false;
    return backupPath;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporaryExists) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
}

function runMigration({
  inputPath = DATA_PATH,
  write = false,
  log = console.log,
} = {}) {
  const targetPath = path.resolve(inputPath);
  let original;
  try {
    original = fs.readFileSync(targetPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${targetPath}: ${error.message}`);
  }

  let data;
  try {
    data = JSON.parse(original);
  } catch (error) {
    throw new Error(`Invalid JSON in ${targetPath}: ${error.message}`);
  }

  const prepared = prepareMigration(data);
  validateMigration(prepared.data);
  const content = `${JSON.stringify(prepared.data, null, 2)}\n`;

  log(`Dataset: ${targetPath} (legacy runtime format)`);
  log(`Mode: ${write ? "WRITE" : "DRY RUN"}`);
  printSummary(log, "Before", prepared.before);
  printSummary(log, "After", prepared.after);

  if (!write) {
    log("No files changed. Pass --write to create a backup and replace this file.");
    return { ...prepared, changed: content !== original, written: false };
  }
  if (content === original) {
    log("Already up to date; no backup or write was needed.");
    return { ...prepared, changed: false, written: false };
  }

  const backupPath = writeSafely(targetPath, content);
  log(`Backup: ${backupPath}`);
  log("Migration written atomically.");
  return { ...prepared, changed: true, written: true, backupPath };
}

function parseArgs(args) {
  let inputPath = DATA_PATH;
  let write = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--write") write = true;
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--input" && args[i + 1]) inputPath = args[++i];
    else if (args[i] === "--help") return { help: true };
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (write && dryRun) throw new Error("Choose either --write or --dry-run, not both.");
  return { inputPath, write };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node data/scripts/migrate-evidence.js [--dry-run | --write] [--input legacy-file]",
      );
    } else {
      runMigration(options);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DATA_PATH,
  prepareMigration,
  runMigration,
  parseArgs,
};
