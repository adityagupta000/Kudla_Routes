# Development

How to work on the code and the data. Read [Architecture](architecture.md) first for the shape of the system.

## Setup

```bash
git clone <repository>
cd kudla-route
npm install            # one production dependency: express
npm run dev            # node --watch backend/index.js, http://localhost:3000
npm test               # 117 tests, about 10 s
```

Requires Node.js 22 or newer. There is no build step, no bundler, no linter and no formatter configured.

## Code map

| Where                     | What to know                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/index.js`        | Order of middleware is significant. Endpoint handlers are short; logic lives in the planner. `clean()` caps text input at 60 characters. `ROUTE_TEMPLATES` controls what request logs may print |
| `backend/planner.js`      | `createPlanner(data)` returns the whole interface. Pure apart from a lazily filled `reach` cache. Constants `MAX_RESULTS` (5) and `AUTOCOMPLETE_LIMIT` (8) live at the top                      |
| `backend/validate.js`     | Collects **all** errors. Exports `validateDataset`, `VALID_EVIDENCE_STATUSES`, `EVIDENCE_DIMENSIONS`                                                                                            |
| `backend/rate-limiter.js` | `createRateLimiter({ clock, cleanupIntervalMs })` so tests can inject a fake clock                                                                                                              |
| `frontend/app.js`         | One IIFE. `h()` builds DOM nodes from text; everything user-visible goes through it                                                                                                             |
| `frontend/navigation.js`  | Request lifecycle and history handling; also loadable from Node for tests                                                                                                                       |
| `data/busData.json`       | Runtime data. See [Data](data.md)                                                                                                                                                               |

Useful for exploring without starting the server:

```bash
node -e '
const { createPlanner } = require("./backend/planner");
const p = createPlanner(require("./data/busData.json"));
console.log(p.resolve("kankandy"));                       // { stop: "Kankanady", corrected: true }
const j = p.plan("Car Street", "Tannirbavi")[0];
console.log(j.changes, j.legs.map(l => l.buses.join("/") + ": " + l.from + " -> " + l.to));
'
```

## Conventions

These are what the code already does. Follow them.

- **CommonJS** modules (`require` / `module.exports`). Plain JavaScript.
- **Comments explain why**, not what. Many decisions (forward-only traversal, why a transfer is dropped, why `confidence` is stripped) are recorded only in comments and tests, so keep them accurate.
- **Keep the planner pure.** No file, network or clock access inside `planner.js`. It makes the exhaustive tests possible.
- **Stay dependency-light.** Express is the only production dependency, which keeps the audit surface and the supply-chain risk small. Adding one needs a reason.
- **Do not claim more than the data supports.** Never show or return the word "verified" for something that is not. `VERIFIED` is rejected in `busData.json` on purpose. Do not expose `confidence`; expose `evidence`.
- **Frontend must stay CSP-clean.** No inline scripts, no inline `style` attributes, no `innerHTML`. Create nodes with `h()`; set styles with `style.setProperty`.
- **Return honest "no result" text.** The UI says "no connection **recorded**", never "no bus".
- **Every change ships with a test**, and a new test file must be added to the explicit list in `package.json`.

## Common tasks

### Add a route

1. Read [Data: updating the data](data.md#updating-the-data). Have evidence.
2. Append to `buses` with the next `id`, an **upper-case** `number`, an ordered `stops` list reusing existing spellings, a `confidence`, and `evidence`:

   ```json
   {
     "id": 100,
     "number": "99X",
     "confidence": "low",
     "evidence": {
       "endpoints": "UNVERIFIED",
       "stopSequence": "UNKNOWN",
       "direction": "UNKNOWN",
       "currentOperation": "UNKNOWN"
     },
     "stops": ["State Bank", "Car Street"]
   }
   ```

3. Run `npm test`. The validator reports every problem by name.
4. **Expect two tests to fail on counts.** `api.test.js` hard-codes 99 buses (and 186 stops) in its health and bus-list checks. Adding one route fails exactly those two tests (checked). Update the literals, and keep any prose figures in these docs in sync.
5. Bump `updated`, restart, and check `/api/health` for the new `dataVersion`.

A route with only two stops and no overlap with existing routes is valid but trivial; real routes connect to existing stops, which is what creates transfers.

### Add an alias

Add `"alias text": "Canonical Stop"` to `aliases`. The target must already be a stop. Matching ignores case and punctuation, so one alias covers `lal bagh`, `Lal-Bagh` and `LAL BAGH`. An alias that normalises to a different stop's name, or two aliases that normalise to the same text, are rejected. An alias equal to a canonical stop's own name is allowed but pointless.

### Merge or rename a stop

Change the spelling in **every** bus that uses it, then run `npm test`. A stop must not appear twice in one bus, and two stops that normalise to the same text are rejected. Before merging stops that look alike, read [Stop identity decisions](data.md#stop-identity-decisions): a wrong merge creates transfers that cannot happen.

### Add an API endpoint

1. Add the handler in `backend/index.js` **below** the security-header and query-shape middleware and **above** the `/api` 404.
2. Put it behind a limiter: reuse `apiLimiter` or create one with `makeRateLimiter(max, windowMs)`.
3. Run text input through `clean()`. Never echo unbounded input.
4. Do not return `confidence`; follow the existing `evidence` shape.
5. Add a template to `ROUTE_TEMPLATES` so the request log prints a route pattern. Without one it is logged as `GET /api/*`.
6. Set `Cache-Control: no-cache` like the other handlers.
7. Add tests to `api.test.js` and document the endpoint in [API](api.md), with a response captured from the running server.

### Change the planner

Run the whole suite; `completeness.test.js` and `exhaustive.test.js` will catch most regressions because they check every stop pair. Specific things to preserve:

- A bus is only traversed forward.
- A journey with an avoidable change is dropped (`hasPointlessChange`).
- No internal cost value leaves the planner.
- Output is sorted by changes, then rides, and capped at 5.

If the change alters which pairs return results, re-measure and update [Planner coverage](planner.md#coverage-measured). Adding a third change is a deliberate, deferred decision (see [Planner](planner.md#journey-search)); do not slip it in.

### Change the evidence model

Touch all of: `validate.js` (allowed statuses and rules), `data.test.js`, `planner.js` (`EVIDENCE_STATUSES` order, the weakest-wins aggregation), and `frontend/app.js` (`evidenceText` and `busEvidenceText`, which currently read only `evidence.endpoints`). Update [Data](data.md#evidence-model).

### Change the frontend

Keep the CSP-clean rules above. Maintain the combobox ARIA attributes, the `role="status"` and `role="alert"` regions, and the stale-response guard (`requestLifecycle.begin()` before a request, `isCurrent()` before rendering). There are no browser tests, so test by hand in a real browser, with keyboard only, and ideally with a screen reader.

## Documentation rules

- One home per fact. Counts and dataset figures live in [Data](data.md) and [Planner](planner.md); other documents link to them.
- Do not hard-code test counts in prose.
- Label examples. Copy API examples from the running server and say so.
- State what has not been verified rather than implying it.
- When a number can be measured, give the command that measures it (see [Planner: reproduce](planner.md#reproduce)).
- Keep `data/templates/pattern-verification.md` where it is: `data/scripts/report.js` prints its path.

## Gotchas

- `normalize()` strips non-ASCII, so non-Latin stop names and queries do not work.
- Bus numbers must be upper case; the validator does not enforce it, and `getBus()` cannot find a lower-case number.
- A stop cannot repeat within a bus, so circular routes cannot be stored.
- `data/scripts/report.js` runs when imported; do not `require` it.
- `data:validate-baseline` rewrites a committed file. Check `git diff` afterwards.
- A comment at the end of `frontend/app.js` about the stop-detail function being "not auto-triggered" is out of date.
