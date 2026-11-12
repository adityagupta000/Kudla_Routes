# Kudla Route — Mangalore Bus Finder

Type where you are and where you're going. The app shows which city bus to take, where to
change if there's no direct bus, and a few alternatives — ranked by total travel cost.

```sh
npm install        # once, from the project root
npm start          # → http://localhost:3000
npm test           # 24 tests: data integrity, planner logic, API
```

Needs **Node 20** or newer. The only dependency is Express.

---

## What it does

- **Direct buses.** Buses sharing the same road are grouped ("17 / 17A / 17B"), and
  different roads between the same two stops are shown as separate options.
- **Alternatives.** Up to five ways to change buses, each using a different pair.
  Changing bus costs the equivalent of 6 extra stops (wait + walk), so a short ride
  plus a change can beat a very long direct route.
- **No pointless changes.** Never says "change at X" when one bus already does the
  whole trip.
- **Typing forgiveness.** `lal bagh`, `statebank`, `kankandy`, `airport`, `IXE` all
  find the right stop. A clear typo is corrected silently; an ambiguous one shows
  "did you mean?" buttons.
- **Honest confidence.** Each route shows whether its ends match online sources
  (see [`DATA_NOTES.md`](DATA_NOTES.md)).
- **Shareable links.** `/?from=State%20Bank&to=Kunjathbail` works as a bookmark.
- **Browse all routes.** A filterable list of every bus and its stops.

Every stop can reach every other stop in at most two changes
(verified across all 34,410 stop pairs).

---

## Layout

```
kudla-route/
├── backend/
│   ├── index.js        Express server + API routes   (~75 lines)
│   └── planner.js      Route-finding logic            (~260 lines)
├── data/
│   └── busData.json    99 buses, 186 stops, aliases
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── fonts/          Self-hosted Barlow woff2 files
├── test/
│   ├── api.test.js     HTTP integration tests
│   ├── data.test.js    Data-integrity guards
│   └── planner.test.js Planner unit tests
├── docs/               Detailed documentation (see below)
├── DATA_NOTES.md       What was checked and what was fixed in the data
└── README.md
```

---

## Documentation

| Doc | What it covers |
|-----|----------------|
| [`docs/architecture.md`](docs/architecture.md) | System overview, directory layout, request lifecycle diagrams |
| [`docs/planner.md`](docs/planner.md) | How route-finding, fuzzy matching, and scoring work |
| [`docs/api.md`](docs/api.md) | Full API reference with request/response examples |
| [`docs/data-format.md`](docs/data-format.md) | busData.json schema, confidence levels, how to improve the data |
| [`docs/contributing.md`](docs/contributing.md) | Development setup, adding routes, running tests, code style |
| [`DATA_NOTES.md`](DATA_NOTES.md) | What was verified online and what was fixed in the original file |

---

## How the planner works

One bus takes you from a stop to every other stop on its route. Call that `reach(stop)`.

- **Direct:** the destination is in `reach(start)`
- **One change:** some stop X is in both `reach(start)` and `reach(destination)`
- **Two changes:** X in `reach(start)` that reaches Y in `reach(destination)`

Each option costs `stops_ridden + 6 × changes`. The cheapest few win.
A single query takes about 0.1 ms — no cache needed.

See [`docs/planner.md`](docs/planner.md) for the full algorithm with diagrams.

---

## API (quick reference)

| Endpoint | Returns |
|----------|---------|
| `GET /api/plan?from=&to=` | Ranked journeys with legs, buses, stops, confidence |
| `GET /api/stops?q=` | Autocomplete (busiest stops when `q` is empty) |
| `GET /api/buses` | Every bus with its full stop list |
| `GET /api/bus/:number` | One bus |

Errors come back as `{ "error": "…" }` in plain English.
Full reference: [`docs/api.md`](docs/api.md).

---

## Technology choices

| Chose | Left out | Why |
|-------|----------|-----|
| Express 5 | NestJS, a rewrite | A small read-only API needs a router and static files |
| One JSON file in memory | SQLite, Neo4j | 99 buses fit in memory; a graph DB for 1–2 hop paths is an anti-pattern |
| ~50 lines of fuzzy matching | Meilisearch, Elasticsearch | 186 stop names |
| No cache | Redis, LRU | Queries take 0.1 ms |
| Plain HTML / CSS / JS | React, Next.js | One form and one result list |
| Same-origin frontend | CORS package | The server serves the page |

---

## Not built, on purpose

- **A map.** No verified coordinates exist for the 186 stops; guessed pins would look
  authoritative and be wrong.
- **Times and fares.** No schedule data. Distances are in stops.
- **Live bus tracking.** Needs data from the operators.

The natural next step is stop coordinates (from OpenStreetMap, confirmed by someone who
rides these buses), which would unlock a map and "stops near me".
