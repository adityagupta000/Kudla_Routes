# API Reference

Base URL: `http://localhost:3000` (default)

All endpoints are **read-only GET** requests. Errors always return JSON:

```json
{ "error": "Human-readable message." }
```

---

## `GET /api/plan`

Plan a journey between two stops.

### Query parameters

| Parameter | Required | Description                                        |
| --------- | -------- | -------------------------------------------------- |
| `from`    | Yes      | Starting stop (name, alias, or partial / mistyped) |
| `to`      | Yes      | Destination stop                                   |

### Success — `200 OK`

```json
{
  "from": "State Bank",
  "to": "Kunjathbail",
  "corrected": { "from": false, "to": false },
  "journeys": [
    {
      "changes": 0,
      "rides": 8,
      "cost": 8,
      "legs": [
        {
          "buses": ["1"],
          "from": "State Bank",
          "to": "Kunjathbail",
          "rides": 8,
          "stops": ["State Bank", "Car Street", "…", "Kunjathbail"],
          "confidence": "high"
        }
      ]
    }
  ]
}
```

`corrected.from` / `corrected.to` are `true` when the server silently fixed a typo.

When no journey exists, `journeys` is `[]` and the response includes:

```json
"tryInstead": ["State Bank", "Lalbagh", "Kankanady"]
```

### Errors

| Status | When                                                       |
| ------ | ---------------------------------------------------------- |
| `400`  | `from` or `to` is missing, or both are the same stop       |
| `404`  | A stop name could not be resolved (includes `suggestions`) |

**404 body:**

```json
{
  "error": "No stop found for \"zzzzzz\".",
  "suggestions": {
    "from": [],
    "to": ["Lalbagh", "Kankanady"]
  }
}
```

---

## `GET /api/stops`

Autocomplete stop names.

### Query parameters

| Parameter | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `q`       | —        | Partial name or typo. Omit to get the busiest stops. |

### Success — `200 OK`

```json
[
  { "name": "Surathkal", "buses": 4 },
  { "name": "Surathkal Beach", "buses": 1 }
]
```

Up to 8 results, ordered by match quality then by number of buses.

---

## `GET /api/buses`

List every bus with its full stop sequence.

### Success — `200 OK`

```json
[
  {
    "id": 1,
    "number": "1",
    "from": "State Bank",
    "to": "Kunjathbail",
    "confidence": "high",
    "stops": ["State Bank", "Car Street", "…", "Kunjathbail"]
  }
]
```

---

## `GET /api/bus/:number`

Fetch one bus by number (case-insensitive).

### Example

```
GET /api/bus/45a
```

### Success — `200 OK`

```json
{
  "id": 45,
  "number": "45A",
  "from": "State Bank",
  "to": "Surathkal",
  "confidence": "low",
  "stops": ["State Bank", "…", "Surathkal"]
}
```

Buses with a `note` field include it:

```json
{ "note": "Runs via Bondel" }
```

### Errors

| Status | When                    |
| ------ | ----------------------- |
| `404`  | No bus with that number |

---

## Field reference

### Journey

| Field     | Type    | Description                              |
| --------- | ------- | ---------------------------------------- |
| `changes` | integer | Number of bus changes (0 = direct)       |
| `rides`   | integer | Total stops ridden across all legs       |
| `cost`    | integer | `rides + 6 × changes` — used for ranking |
| `legs`    | Leg[]   | Ordered list of legs                     |

### Leg

| Field        | Type                              | Description                                       |
| ------------ | --------------------------------- | ------------------------------------------------- |
| `buses`      | string[]                          | Bus numbers that share this exact road            |
| `from`       | string                            | Boarding stop                                     |
| `to`         | string                            | Alighting stop                                    |
| `rides`      | integer                           | Stops ridden on this leg                          |
| `stops`      | string[]                          | Full stop sequence including endpoints            |
| `confidence` | `"high"` \| `"medium"` \| `"low"` | Confidence of the least-trusted bus in this group |

### Bus

| Field        | Type                              | Description                          |
| ------------ | --------------------------------- | ------------------------------------ |
| `id`         | integer                           | Internal numeric id                  |
| `number`     | string                            | Route number e.g. `"17A"`            |
| `from`       | string                            | First stop                           |
| `to`         | string                            | Last stop                            |
| `confidence` | `"high"` \| `"medium"` \| `"low"` | How well verified the route ends are |
| `note`       | string?                           | Optional free-text note              |
| `stops`      | string[]                          | Complete stop list                   |

---

## Shareable URLs

The frontend keeps the search in the address bar:

```
/?from=State%20Bank&to=Kunjathbail
```

You can link directly to a pre-filled search result.
