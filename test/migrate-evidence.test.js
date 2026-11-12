"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  prepareMigration,
  runMigration,
} = require("../data/scripts/migrate-evidence");

function legacyData(overrides = {}) {
  return {
    updated: "2026-11-12",
    buses: [
      {
        id: 1,
        number: "1",
        confidence: "high",
        stops: ["Origin", "Destination"],
        ...overrides,
      },
    ],
    aliases: {},
  };
}

function withTempFile(content, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kudla-evidence-"));
  const inputPath = path.join(directory, "busData.json");
  fs.writeFileSync(inputPath, content, "utf8");
  try {
    return callback(inputPath, directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("evidence migration is idempotent", () => {
  const first = prepareMigration(legacyData());
  const second = prepareMigration(first.data);
  assert.deepEqual(second.data, first.data);
  assert.deepEqual(second.after, first.after);
});

test("migration preserves existing stronger evidence without replacing dimensions", () => {
  const evidence = {
    endpoints: "PARTIALLY_VERIFIED",
    stopSequence: "PARTIALLY_VERIFIED",
    researcherNote: "Keep this metadata.",
  };
  const result = prepareMigration(legacyData({ confidence: "low", evidence }));
  assert.deepEqual(result.data.buses[0].evidence, {
    endpoints: "PARTIALLY_VERIFIED",
    stopSequence: "PARTIALLY_VERIFIED",
    direction: "UNKNOWN",
    currentOperation: "UNKNOWN",
    researcherNote: "Keep this metadata.",
  });
});

test("migration never downgrades VERIFIED evidence, even when validation blocks writing", () => {
  const source = legacyData({
    evidence: {
      endpoints: "VERIFIED",
      stopSequence: "VERIFIED",
      direction: "VERIFIED",
      currentOperation: "VERIFIED",
    },
  });
  const prepared = prepareMigration(source);
  assert.deepEqual(prepared.data.buses[0].evidence, source.buses[0].evidence);

  const raw = JSON.stringify(source, null, 2);
  withTempFile(raw, (inputPath, directory) => {
    assert.throws(
      () => runMigration({ inputPath, write: true, log() {} }),
      /claims VERIFIED/,
    );
    assert.equal(fs.readFileSync(inputPath, "utf8"), raw);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".bak.")),
      [],
    );
  });
});

test("default mode is dry-run and prints before/after summaries without writing", () => {
  const raw = JSON.stringify(legacyData(), null, 2);
  withTempFile(raw, (inputPath, directory) => {
    const output = [];
    const result = runMigration({ inputPath, log: (line) => output.push(line) });
    assert.equal(result.written, false);
    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(inputPath, "utf8"), raw);
    assert.match(output.join("\n"), /Mode: DRY RUN/);
    assert.match(output.join("\n"), /Before: 1 buses/);
    assert.match(output.join("\n"), /After: 1 buses/);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".bak.")),
      [],
    );
  });
});

test("invalid JSON and direction-aware input are rejected without writes", () => {
  withTempFile("{not json", (inputPath) => {
    assert.throws(
      () => runMigration({ inputPath, write: true, log() {} }),
      /Invalid JSON/,
    );
    assert.equal(fs.readFileSync(inputPath, "utf8"), "{not json");
  });
  assert.throws(
    () => prepareMigration({ routes: [], stops: [] }),
    /legacy runtime format/,
  );
});

test("failed validation leaves the input untouched and creates no backup", () => {
  const raw = JSON.stringify(
    legacyData({ confidence: "not-a-confidence" }),
    null,
    2,
  );
  withTempFile(raw, (inputPath, directory) => {
    assert.throws(
      () => runMigration({ inputPath, write: true, log() {} }),
      /confidence must be one of/,
    );
    assert.equal(fs.readFileSync(inputPath, "utf8"), raw);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".bak.")),
      [],
    );
  });
});

test("explicit writes create an exact backup and repeated writes are no-ops", () => {
  const raw = JSON.stringify(legacyData(), null, 2);
  withTempFile(raw, (inputPath, directory) => {
    const first = runMigration({ inputPath, write: true, log() {} });
    assert.equal(first.written, true);
    assert.equal(fs.readFileSync(first.backupPath, "utf8"), raw);
    const migratedBytes = fs.readFileSync(inputPath, "utf8");

    const second = runMigration({ inputPath, write: true, log() {} });
    assert.equal(second.written, false);
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(inputPath, "utf8"), migratedBytes);
    assert.equal(
      fs.readdirSync(directory).filter((name) => name.includes(".bak.")).length,
      1,
    );
  });
});
