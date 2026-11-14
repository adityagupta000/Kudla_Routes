# API

Six read-only `GET` endpoints, same-origin, JSON. There is no authentication and no version prefix.

Every example below was **captured from the running server** against the committed dataset (`dataVersion` `b11f421d`) on 2026-11-13. Long arrays are shortened and marked with `…`; nothing else is edited. If you change `data/busData.json`, real responses will differ.

| Endpoint                                    | Purpose                           | Rate limit             |
| ------------------------------------------- | --------------------------------- | ---------------------- |
| [`GET /api/plan`](#get-apiplan)             | Journeys between two stops        | 30 per minute          |
| [`GET /api/stops`](#get-apistops)           | Autocomplete                      | 120 per minute         |
| [`GET /api/stop/:name`](#get-apistopname)   | One stop and the buses serving it | 60 per minute (shared) |
| [`GET /api/buses`](#get-apibuses)           | All routes                        | 60 per minute (shared) |
| [`GET /api/bus/:number`](#get-apibusnumber) | One route                         | 60 per minute (shared) |
| [`GET /api/health`](#get-apihealth)         | Liveness, counts, data version    | 60 per minute (shared) |

"Shared" means the four endpoints use one counter per client IP. Limits are per client IP, per process, in a fixed 60-second window.

## Conventions

**Inputs**

- `from`, `to`, `q` and the `:name` path segment are trimmed and cut to **60 characters**. The `:number` segment is **not** trimmed or capped.
- Query parameters must appear once and be strings. A repeated parameter returns `400` with `Query parameter "from" must not be repeated.` (A non-string value returns `... must be a string.`, which the default query parser cannot produce.) Keys such as `q[]` are simply different keys and are ignored.
- Stop names are resolved with the matching rules in [Planner](planner.md#search-and-stop-resolution). Names are case-insensitive and tolerate spacing, aliases and small typos.

**Responses**

- JSON, UTF-8. Errors are `{ "error": "<message>" }`; unresolved stops add `suggestions`.
- Security headers are sent on every response ([Security](security.md#http-headers)).
- Matched handlers send `Cache-Control: no-cache` with an ETag. Early error responses (query-shape `400`, unmatched `/api/*` `404`, rate-limit `429`) do **not** send `Cache-Control`.
- `confidence` is never returned. Use `evidence`.

**Evidence object.** Each bus and each leg carries four independent statuses:

```json
{
  "endpoints": "PARTIALLY_VERIFIED",
  "stopSequence": "UNKNOWN",
  "direction": "UNKNOWN",
  "currentOperation": "UNKNOWN"
}
```

| Status                      | Meaning                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `VERIFIED`                  | Independently confirmed. **Never present in the current data**; the validator rejects it in `busData.json` |
| `PARTIALLY_VERIFIED`        | Partly confirmed. Today it means only that the first and last stops matched a published source             |
| `UNVERIFIED`                | Not confirmed against any source                                                                           |
| `CONFLICTING`, `HISTORICAL` | Sources disagree, or only old evidence exists. Reserved; not used in current data                          |
| `UNKNOWN`                   | No evidence either way                                                                                     |

In the current data, `endpoints` is `PARTIALLY_VERIFIED` for 74 routes and `UNVERIFIED` for 25. The other three dimensions are `UNKNOWN` for all 99. For a leg that groups several buses, each dimension is the **weakest** of the group.

## GET /api/plan

Journeys from `from` to `to`: direct, one change or two changes, at most 5, ranked by fewer changes then fewer stops.

| Parameter | Required | Notes            |
| --------- | -------- | ---------------- |
| `from`    | yes      | Start stop       |
| `to`      | yes      | Destination stop |

### Direct journey

`GET /api/plan?from=State%20Bank&to=Kunjathbail` → `200` (stop lists shortened)

```json
{
  "from": "State Bank",
  "to": "Kunjathbail",
  "corrected": { "from": false, "to": false },
  "journeys": [
    {
      "changes": 0,
      "rides": 8,
      "legs": [
        {
          "buses": ["1"],
          "from": "State Bank",
          "to": "Kunjathbail",
          "rides": 8,
          "stops": ["State Bank", "Car Street", "…", "Kunjathbail"],
          "evidence": {
            "endpoints": "PARTIALLY_VERIFIED",
            "stopSequence": "UNKNOWN",
            "direction": "UNKNOWN",
            "currentOperation": "UNKNOWN"
          }
        }
      ],
      "rankingNote": "Ranked by fewer transfers first, then fewer stops. This is a heuristic — not travel time."
    },
    {
      "changes": 0,
      "rides": 17,
      "legs": [{ "buses": ["17", "17A", "17B"], "…": "…" }],
      "rankingNote": "…"
    }
  ]
}
```

`rides` is the number of stops travelled (stops in the leg minus one). `stops` is the full ordered list for the leg, including both ends. Buses listed together in `buses` share an identical stored stop sequence between the two stops.

### Journey with a change

`GET /api/plan?from=Car%20Street&to=Tannirbavi` → `200` (first of 2 journeys; `stops` omitted)

```json
{
  "from": "Car Street",
  "to": "Tannirbavi",
  "corrected": { "from": false, "to": false },
  "journeys": [
    {
      "changes": 1,
      "rides": 6,
      "legs": [
        {
          "buses": ["1", "1B", "13", "13A"],
          "from": "Car Street",
          "to": "Urva Stores",
          "rides": 4,
          "…": "…"
        },
        {
          "buses": ["1A"],
          "from": "Urva Stores",
          "to": "Tannirbavi",
          "rides": 2,
          "…": "…"
        }
      ],
      "rankingNote": "…"
    }
  ]
}
```

### Corrected input

`GET /api/plan?from=kankandy&to=lalbag` → `200`. `from` and `to` hold the **resolved** names, and `corrected` says which inputs were changed.

```json
{
  "from": "Kankanady",
  "to": "Lalbagh",
  "corrected": { "from": true, "to": true },
  "journeys": ["… 5 journeys"]
}
```

The page compares what the user typed with the resolved name to decide whether to show a "Showing results for" message.

### No journey

An empty result is still `200`. Two extra fields are present **only** when `journeys` is empty:

- `reverseRecorded` is `true` if `plan(to, from)` returns something. It means "the opposite direction is recorded", nothing more.
- `popularStops` lists the three stops with the most routes. These are the busiest stops, **not** stops that are geographically near.

`GET /api/plan?from=Kunjathbail&to=State%20Bank` → `200`

```json
{
  "from": "Kunjathbail",
  "to": "State Bank",
  "corrected": { "from": false, "to": false },
  "journeys": [],
  "reverseRecorded": true,
  "popularStops": ["State Bank", "Lalbagh", "Jyothi"]
}
```

`GET /api/plan?from=Derebail&to=Surathkal` → `200`, same shape with `"reverseRecorded": false`.

### Errors

| Request                         | Status | Body                                                            |
| ------------------------------- | ------ | --------------------------------------------------------------- |
| `from` or `to` missing or blank | 400    | `{ "error": "Enter a starting stop and a destination." }`       |
| Both resolve to the same stop   | 400    | `{ "error": "Your start and destination are the same stop." }`  |
| A stop cannot be resolved       | 404    | see below                                                       |
| Repeated query parameter        | 400    | `{ "error": "Query parameter \"from\" must not be repeated." }` |

`GET /api/plan?from=Kot&to=Lalbagh` → `404`. `suggestions` is keyed by the input that failed; here only `from`:

```json
{
  "error": "No stop found for \"Kot\".",
  "suggestions": {
    "from": [
      "Kottara Chowki",
      "Kottara Cross",
      "Kotekar",
      "Kotepura",
      "Kottara"
    ],
    "to": []
  }
}
```

If both inputs fail, the message names both (`No stop found for "x" or "y".`). Input that matches nothing returns empty suggestion arrays.

## GET /api/stops

Autocomplete. `q` is optional; with no `q` it returns the busiest stops. At most 8 results.

`GET /api/stops?q=surath` → `200`

```json
[
  { "name": "Surathkal", "buses": 18 },
  { "name": "Chokkabettu", "buses": 4 }
]
```

`GET /api/stops` → `200` (first three of 8)

```json
[
  { "name": "State Bank", "buses": 84 },
  { "name": "Lalbagh", "buses": 37 },
  { "name": "Jyothi", "buses": 36 }
]
```

Here `buses` is a **count**. (In [`/api/stop/:name`](#get-apistopname) the same word is an array.) The second result for `surath` is a fuzzy match, which is why short or misspelled queries can show loosely related stops.

## GET /api/stop/:name

One stop, resolved with the same rules as `/api/plan` (exact or unique match), and every bus that serves it.

`GET /api/stop/Lalbagh` → `200` (2 of 37 buses shown)

```json
{
  "name": "Lalbagh",
  "aliases": ["Lal Bagh"],
  "buses": [
    {
      "number": "1A",
      "evidence": { "endpoints": "PARTIALLY_VERIFIED", "…": "…" },
      "from": "State Bank",
      "to": "Tannirbavi"
    },
    {
      "number": "1C",
      "evidence": { "endpoints": "UNVERIFIED", "…": "…" },
      "from": "State Bank",
      "to": "Kodikal"
    }
  ],
  "note": "Service availability and schedules are not guaranteed. Direction patterns are as stored; return directions have not been independently verified."
}
```

`from` and `to` on each bus are that route's first and last stop, not the position relative to this stop.

Ambiguous or unknown names return `404` with a **flat** list (unlike `/api/plan`):

`GET /api/stop/Kot` → `404`

```json
{
  "error": "No stop found for \"Kot\".",
  "suggestions": [
    "Kottara Chowki",
    "Kottara Cross",
    "Kotekar",
    "Kotepura",
    "Kottara"
  ]
}
```

A name that matches a stop exactly always succeeds: `/api/stop/kadri` returns _Kadri_, even though _Kadri Market_ and _Kadri Temple_ also exist.

## GET /api/buses

All 99 routes as an array, in dataset order.

`GET /api/buses` → `200` (first element; `stops` shortened)

```json
{
  "id": 1,
  "number": "1",
  "from": "State Bank",
  "to": "Kunjathbail",
  "evidence": {
    "endpoints": "PARTIALLY_VERIFIED",
    "stopSequence": "UNKNOWN",
    "direction": "UNKNOWN",
    "currentOperation": "UNKNOWN"
  },
  "stops": ["State Bank", "Car Street", "…", "Kunjathbail"]
}
```

A bus may also carry a `note` (9 of the 99 do), for example route `1C`: `"Both sources start this route at Mangaladevi; this data starts at State Bank."`

## GET /api/bus/:number

One route. The number is matched **case-insensitively** (`45a` finds `45A`).

`GET /api/bus/45a` → `200` (`stops` shortened)

```json
{
  "id": 65,
  "number": "45A",
  "from": "State Bank",
  "to": "Chokkabettu",
  "evidence": {
    "endpoints": "UNVERIFIED",
    "stopSequence": "UNKNOWN",
    "direction": "UNKNOWN",
    "currentOperation": "UNKNOWN"
  },
  "stops": ["State Bank", "…", "Chokkabettu"]
}
```

`GET /api/bus/999` → `404`

```json
{ "error": "No bus numbered 999." }
```

The 404 message repeats the path segment exactly as received, with no length cap or trimming. It is returned as JSON, so it is not an injection risk by itself, but anything that renders it must treat it as text.

## GET /api/health

`GET /api/health` → `200`

```json
{ "status": "ok", "stops": 186, "buses": 99, "dataVersion": "b11f421d" }
```

`dataVersion` is the first 8 hex characters of the SHA-1 of the re-serialised dataset. It changes whenever the data content changes. There is no readiness distinction: if the process is serving requests, the dataset has already validated (otherwise the process would have exited).

## Status codes and errors

| Status | When                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Success, including "no journey"                                                                                                           |
| 400    | Missing or repeated parameters, same start and destination                                                                                |
| 404    | Unresolved stop, unknown bus, unmatched `/api/*` path (`{ "error": "Not found." }`)                                                       |
| 429    | Rate limit exceeded                                                                                                                       |
| 500    | Unexpected error: `{ "error": "Something went wrong on the server." }`. No stack trace is returned; the error object is written to stderr |

### Rate limit response

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

```json
{ "error": "Too many requests. Please slow down.", "retryAfterMs": 59860 }
```

`Retry-After` is in seconds and is rounded up from the time left in the window. The counter increments on every request, including rejected ones.

Verified by sending 31 requests to `/api/plan` from one address: the 31st returns `429`; `/api/health` from the same address is still `200`.

## Other behaviour

- Methods other than `GET` on `/api/*` return the JSON `404` (for example `POST /api/plan`). `HEAD` works wherever `GET` does.
- A malformed percent-encoding such as `/api/stop/%E0%A4%A` returns **500**, not 400. The server's error handler does not distinguish a bad request from a server fault, and a test pins this behaviour. It is listed in [Status and limitations](status-and-limitations.md#known-issues).
- Query strings, stop names and bus numbers never appear in server logs. Logs use route templates such as `GET /api/stop/:name`.
