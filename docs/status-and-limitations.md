# Status and limitations

An honest account of where the project stands: what has been verified, what has not, the bugs and rough edges that were found, and what is still open. Statements marked **reproduced** were re-run on 2026-11-13 from the exported files (Node 22.23.4, Linux). Everything else comes from reading the code and data.

## Verdict

**Not release-ready on the evidence available.** This is the project's own earlier conclusion, and the evidence still supports it.

That does not mean the code is broken. The planner is complete and consistent for the data it has, the test suite passes, and the application does what its README says when run locally. It means four things have no evidence behind them:

1. **The data is not fit for passenger guidance.** Route endpoints were checked for most routes against public pages; stop order, direction and current operation are unconfirmed for all 99 (see [Data](data.md#evidence-model)).
2. **It has never been deployed or tested in a browser.** There is no hosting record, no TLS or proxy validation, no browser or accessibility test, and no recorded CI run.
3. **Coverage is narrow by construction.** Only 30.7% of stop pairs return a journey, mostly because routes are stored one way (see [Planner coverage](planner.md#coverage-measured)).
4. **Security hardening is real but untested outside the code.** Headers and rate limits were observed on a live process, but not in a browser or behind a proxy, and the limiter is per-process.

For a demo, a pilot with clear labelling, or local use, the current state is reasonable. For public guidance people may rely on to catch a bus, it is not supported by evidence.

## What has been verified

| Claim                                                              | Evidence                                                       | Reproduced                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------- |
| All 117 tests pass                                                 | `npm test`                                                     | Yes: 117 pass, 0 fail, 0 skipped                     |
| Planner finds every pair reachable within two changes              | Independent BFS over all 34,410 pairs, `completeness.test.js`  | Yes: 0 missed                                        |
| Dataset size: 99 buses, 186 stops, 36 aliases; confidence 49/25/25 | Computed from `busData.json`                                   | Yes                                                  |
| Baseline dataset restates the runtime data exactly                 | Compared all 99 sequences, aliases and stops                   | Yes: identical                                       |
| Committed validation report matches the data                       | Regenerated: byte-identical, 280,134 bytes                     | Yes                                                  |
| No known vulnerable dependencies                                   | `npm audit --audit-level=high` on a fresh tree (Express 5.3.0) | Yes: 0 vulnerabilities (not the repo's own lockfile) |
| Security headers and rate limits behave as documented              | Observed on a running server                                   | Yes                                                  |
| Startup fails cleanly on bad or missing data                       | Ran with a missing file and an invalid file                    | Yes                                                  |
| Graceful shutdown on `SIGTERM`                                     | Sent the signal                                                | Yes: exit code 0                                     |
| Frontend never writes HTML strings                                 | Searched `frontend/` for HTML sinks                            | Yes: none                                            |

## Known issues

Found by reading and by running the code. None has been fixed as part of writing this documentation. Each is small.

### In the application

| #   | Issue                                                                                                                                                                                                                                                      | Evidence                                       | Suggested fix                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **A port conflict is silent.** The second process prints "Bus finder running…" and exits with code 0. Express 5 passes listen errors to the `app.listen` callback, which ignores them                                                                      | Started two servers on one port                | Handle the callback's `err` argument and `process.exit(1)` ([Operations](operations.md#known-issue-a-port-conflict-is-silent)) |
| 2   | **A malformed URL returns 500.** `/api/stop/%E0%A4%A` is a client error but the error handler reports a server fault                                                                                                                                       | Real HTTP; pinned by `api.test.js`             | Return 400 when the error is a URI decode error                                                                                |
| 3   | **`/api/bus/:number` echoes its input unbounded.** The path segment is not trimmed or capped, and appears in the 404 message                                                                                                                               | Sent a 500-character value: it came back whole | Run it through `clean()` like the other inputs                                                                                 |
| 4   | **Lower-case bus numbers pass validation but are unreachable.** `getBus()` upper-cases the lookup but the map keeps raw keys, so `/api/bus/99x` and `/api/bus/99X` both 404 for a route stored as `99x`                                                    | Added such a route in a scratch copy           | Enforce upper case in `validateDataset`, or normalise when indexing                                                            |
| 5   | **The UI's evidence text is hard-coded.** Every leg says "Stop order, direction, and current service: not independently confirmed" and the text reads only `evidence.endpoints`. It is accurate today but will stay wrong if other dimensions get verified | `frontend/app.js` `evidenceText()`             | Build the text from all four dimensions                                                                                        |
| 6   | **Inconsistent API shapes.** `buses` is a count in `/api/stops` and an array in `/api/stop/:name`; `suggestions` is `{from, to}` for `/api/plan` and a flat array for `/api/stop/:name`                                                                    | [API](api.md) captured responses               | Rename (`busCount`) in a future breaking version; document until then                                                          |
| 7   | **Non-ASCII input is silently treated as empty.** `normalize()` keeps only `a-z0-9`, so a Kannada-script query returns the busiest stops as suggestions                                                                                                    | Ran `resolve` on a Kannada string              | Document, or extend `normalize` if native-script names are ever added                                                          |
| 8   | **Stop-detail panel opens at the bottom of the results**, far from the stop clicked                                                                                                                                                                        | Code reading                                   | Insert it next to the clicked stop                                                                                             |

### In tooling and tests

| #   | Issue                                                                                                                                                                                                                                                                         | Evidence                        | Suggested fix                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| 9   | **`scripts/smoke.js` always fails one check and exits 1.** The home-page check goes through the JSON helper, which calls `res.json()` on HTML                                                                                                                                 | Ran it: 11 of 12 pass           | Give the HTML check its own code path             |
| 10  | **`data/scripts/report.js` runs on import and prints a stale message.** No `require.main` guard; it says "may take ~30s" but takes under a second; its "matched >=2 sources" wording contradicts its own header rule that no source counts be printed until a register exists | Ran it; read it                 | Add a guard; update the text                      |
| 11  | **`direction-aware-report.js` has a latent counting bug.** It counts routes with a verified reverse pattern via `pattern.route_id`, which patterns do not have. Today the count is 0 and correct; once any exist it will be wrong                                             | Checked every pattern's keys    | Track the route while iterating                   |
| 12  | **The JSON Schema for the baseline is unused and loose.** No script reads it; statuses are free strings; only the top level forbids extra properties; the `$id` is a placeholder (`example.invalid`)                                                                          | Searched the code               | Wire it into validation or label it documentation |
| 13  | **Some tests promise more than they check** (listed in [Testing](testing.md#tests-whose-names-promise-more-than-they-check)), including one that cannot fail                                                                                                                  | Read the tests                  | Rename or strengthen them                         |
| 14  | **Two `api.test.js` tests hard-code 99 buses.** Adding a route fails them                                                                                                                                                                                                     | Added a route in a scratch copy | Derive the expected count from the data           |
| 15  | **Backup file names differ and are not git-ignored.** `migrate-evidence.js` writes `busData.json.bak.<ts>.<pid>`; the manual procedure uses `.bak-YYYYMMDD-HHMMSS`                                                                                                            | Code and docs                   | Add `*.bak*` to `.gitignore`                      |

### In the repository

| #   | Issue                                                                                                                                                                                                                                                                                   | Evidence                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 16  | **`frontend/favicon.svg` is linked by `index.html` but was not in the reviewed file tree**, so browsers may get a 404                                                                                                                                                                   | Searched the tree       |
| 17  | **Files described elsewhere were not in the export:** `.env.example` and `.github/workflows/ci.yml` (named in the earlier README), and a `LICENSE` file (`package.json` declares ISC). `style.css`, the fonts and `package-lock.json` were listed but their contents were not available | File tree of the export |
| 18  | **A stale comment.** The tail of `frontend/app.js` says the stop-detail function is "not auto-triggered"; it is, through the stop-name buttons                                                                                                                                          | Read the file           |

Items 16 and 17 may be artefacts of how the export was made. Confirm them in the real repository before acting.

## Limits that come from the data

These are not bugs; they follow from what has been collected. Numbers are from [Planner](planner.md#coverage-measured) and [Data](data.md#dataset-facts).

- **Star-shaped network.** 84 of 99 routes start at _State Bank_, so it reaches 180 of 185 other stops, but **nothing can reach it**. 36 stops can never be a start and 4 never a destination.
- **One direction per route.** Return trips are mostly absent, not "no bus runs".
- **Three or more changes are not searched.** 1,603 pairs (13% of reachable pairs) are affected.
- **Stop sequences are unverified.** A spot check of 8 routes found the intermediate stops differed from a second public source every time.
- **Older numbering.** The dataset uses an older route-numbering scheme than the newer one on Wikipedia.
- **No coordinates**, so no map and no distance or walking information.
- **Six groups of similarly named stops are unresolved** (a seventh, _Bajpe_ and _Bajpe Airport_, is confirmed separate; see [Stop identity](data.md#stop-identity-decisions)).
- **A leg lists only the best road** between two transfer points; alternative roads for a transfer leg are not shown.

## Decisions made and deferred

| Topic                                      | Decision                                | Reason                                                                                           |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Map                                        | Not built                               | No verified coordinates; guessing was rejected                                                   |
| Return directions                          | Not invented                            | Showing an unverified direction would be a fabrication                                           |
| Third change                               | Deferred                                | Many of the 1,230 three-change pairs may disappear once return patterns exist; extra search cost |
| Alternatives per transfer leg              | Deferred                                | Low impact (journeys are deduplicated by path)                                                   |
| Moving the runtime to the baseline dataset | Not started                             | Needs a planner and validator rewrite                                                            |
| Browser and accessibility tests            | Deferred                                | No test tooling exists; a placeholder Playwright step was removed from the workflow              |
| `confidence` label                         | Kept internally, hidden from API and UI | It described endpoint matching only                                                              |

## Risk register

Status of the risks identified by the earlier audit, updated with what was reproduced.

| ID       | Risk                                                            | Status now                                                                                       |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| DEF-001  | No API regression coverage                                      | **Fixed.** In-process API tests pass (no real TCP or browser)                                    |
| DEF-002  | Planner invented reverse traversal                              | **Fixed.** Forward-only; tests pass                                                              |
| DEF-003  | One confidence label mistaken for whole-route evidence          | **Fixed in design and tests.** Evidence dimensions exist; the facts themselves remain unverified |
| DEF-004  | Test command broken on Windows                                  | **Fixed.** Explicit file list in `package.json`; suite passes (reproduced)                       |
| DEF-005  | Two-change search skipped when three one-change results existed | **Fixed.** Runs whenever there is no direct journey                                              |
| DEF-006  | Dedup key could collapse different alternatives                 | **Fixed.** Keyed on ordered stop paths                                                           |
| RISK-001 | Missing HTTP security headers                                   | **Fixed and observed** on a live server; not scanned in a browser                                |
| RISK-002 | Request flooding                                                | **Partly mitigated.** Per-process limits; no load test, no shared store                          |
| RISK-003 | Error disclosure                                                | **Fixed.** Generic 500; the raw error still goes to stderr                                       |
| RISK-004 | Two datasets could be confused                                  | **Mitigated** by documentation; both are labelled                                                |
| RISK-005 | Reachability read as real-world coverage                        | **Mitigated** by wording; now quantified                                                         |
| OPS-001  | Dependency audit                                                | **Reproduced clean** on a fresh tree; CI run still absent                                        |
| WEB-001  | No browser or accessibility verification                        | **Open**                                                                                         |
| DEP-001  | No deployment verification                                      | **Open**                                                                                         |

## How it got here

The project went through a structured audit. In outline: the first baseline had 24 tests with 6 failing (an API test harness broken under Express 5, and several defects above). Since then: forward-only traversal replaced bidirectional guessing; two-change search and deduplication were corrected; the dataset gained per-dimension evidence and a startup validator; the API gained a stable contract, input limits and rate limiting; the frontend gained stale-response protection, URL history and a stop-detail view; security headers and a strict CSP were added; the suite grew to 117 tests including exhaustive checks over all stop pairs. A 27-pair planner regression (a "pointless change" rule that wrongly rejected valid journeys) was found by the independent oracle and fixed.

The detailed work logs from that audit have been retired in favour of these documents. If you need them, recover them from version control.

## Open work

Suggestions only, in rough order of value for effort. They are not planned work.

1. Fix issues 1, 9, 2 and 3: a few lines each, and 1 and 9 affect anyone running or checking a deployment.
2. Enforce upper-case bus numbers (issue 4) and make the evidence text read all four dimensions (issue 5).
3. Rename or strengthen the misleading tests (issue 13).
4. Confirm whether `favicon.svg`, `.env.example`, the CI workflow and `LICENSE` exist; add what is missing.
5. Deploy it somewhere, put it behind TLS and a proxy, and run the smoke script there.
6. Add a real-browser pass: keyboard-only, a screen reader and an automated accessibility check.
7. Data work, all of it human: field-verify routes and **return directions** (the biggest single gain: up to 926 more reachable stop pairs per `npm run data:report`), resolve the similarly named stops, record evidence per claim, and only then revisit three-change search and coordinates.
