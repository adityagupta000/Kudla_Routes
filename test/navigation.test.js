"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createRequestLifecycle,
  handlePopState,
} = require("../frontend/navigation");

function fakeButton() {
  const attributes = new Map();
  return {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
  };
}

test("a newer invalid submission aborts pending work and clears aria-busy", async () => {
  const button = fakeButton();
  const lifecycle = createRequestLifecycle(button);
  const oldRequest = lifecycle.begin();
  lifecycle.markBusy(oldRequest);

  let resolveResponse;
  const oldResponse = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const rendered = [];
  const renderOldResponse = oldResponse.then((value) => {
    if (oldRequest.isCurrent()) rendered.push(value);
  });

  const invalidSubmission = lifecycle.begin();
  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(oldRequest.isCurrent(), false);
  assert.equal(button.hasAttribute("aria-busy"), false);
  assert.equal(invalidSubmission.isCurrent(), true);

  resolveResponse("stale result");
  await renderOldResponse;
  assert.deepEqual(rendered, []);
});

test("history navigation without journey parameters invalidates work and clears results", async () => {
  const button = fakeButton();
  const lifecycle = createRequestLifecycle(button);
  const oldRequest = lifecycle.begin();
  lifecycle.markBusy(oldRequest);
  let resolveResponse;
  const oldResponse = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const rendered = [];
  const renderOldResponse = oldResponse.then((value) => {
    if (oldRequest.isCurrent()) rendered.push(value);
  });
  const fromInput = { value: "Old origin" };
  const toInput = { value: "Old destination" };
  let cleared = false;
  let ran = false;

  handlePopState({ state: null }, {
    search: "",
    fromInput,
    toInput,
    run: () => { ran = true; },
    invalidate: () => lifecycle.invalidate(),
    clearResults: () => { cleared = true; },
  });

  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(oldRequest.isCurrent(), false);
  assert.equal(button.hasAttribute("aria-busy"), false);
  assert.equal(cleared, true);
  assert.equal(ran, false);

  resolveResponse("stale result");
  await renderOldResponse;
  assert.deepEqual(rendered, []);
});

test("history navigation with journey parameters supersedes the pending request", () => {
  const button = fakeButton();
  const lifecycle = createRequestLifecycle(button);
  const oldRequest = lifecycle.begin();
  lifecycle.markBusy(oldRequest);
  const fromInput = { value: "" };
  const toInput = { value: "" };
  let newRequest;

  handlePopState({ state: null }, {
    search: "?from=State%20Bank&to=Kunjathbail",
    fromInput,
    toInput,
    run: () => { newRequest = lifecycle.begin(); },
    invalidate: () => lifecycle.invalidate(),
    clearResults() {},
  });

  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(oldRequest.isCurrent(), false);
  assert.equal(fromInput.value, "State Bank");
  assert.equal(toInput.value, "Kunjathbail");
  assert.equal(newRequest.isCurrent(), true);
});

test("browser loads navigation lifecycle before app.js and app retains request timeout", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../frontend/index.html"),
    "utf8",
  );
  const app = fs.readFileSync(
    path.resolve(__dirname, "../frontend/app.js"),
    "utf8",
  );
  assert.ok(html.indexOf('src="navigation.js"') < html.indexOf('src="app.js"'));
  assert.match(app, /requestLifecycle\.begin\(\)/);
  assert.match(app, /requestLifecycle\.invalidate\(\)/);
  assert.match(app, /handlePopState\(event/);
  assert.match(app, /invalidate: \(\) => requestLifecycle\.invalidate\(\)/);
  assert.match(app, /request\.isCurrent\(\)/);
  assert.match(app, /AbortSignal\.timeout\(RUN_TIMEOUT_MS\)/);
  assert.ok(
    app.indexOf("const request = requestLifecycle.begin()") <
      app.indexOf("if (!from || !to)"),
    "A new request generation must be claimed before invalid-input handling",
  );
});
