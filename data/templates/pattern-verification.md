# Pattern Verification Record

**Instructions:** Copy this file to `data/verified/pattern-<route_number>.md`.
Fill in every field. Do not guess — leave UNKNOWN if unsure.
One file per verified direction. A route with both directions needs two files.

This record is evidence for a research/migration baseline. Do not copy a status
to `data/busData.json` without its provenance; the runtime validator currently
rejects `VERIFIED` because that legacy format has no per-claim source references.
Legacy `confidence` records published-source endpoint comparison only. A field
ride does not by itself cross-check endpoints against published sources and
must not automatically change confidence.

---

## Route identity

| Field | Value |
|-------|-------|
| Bus number | _(e.g. 17A)_ |
| Route name / common name | _(e.g. "Mangalore Central → Surathkal via Mukka")_ |
| Direction | FORWARD or RETURN _(delete as appropriate)_ |
| Operator | _(e.g. NEKRTC, Private — name if known)_ |
| Verification date | YYYY-MM-DD |
| Verified by | _(initials or role; no personal details required)_ |

---

## Source references

List every source or field observation used. Identify what each one actually
supports; route-number presence alone supports neither stop sequence nor
current operation.

| # | Source type | Source name / URL | Date accessed | Agrees on endpoints? | Agrees on stop order? |
|---|-------------|-------------------|---------------|----------------------|-----------------------|
| 1 | | | | Yes / No / Partial | Yes / No / Partial |
| 2 | | | | Yes / No / Partial | Yes / No / Partial |

**Source types:** `OnlineRoute` `OperatorWebsite` `WikipediaRoute` `BlogPost`
`FieldRide` `PassengerInterview` `DriverInterview` `OfficialTimetable`

---

## Endpoint evidence

| Field | Value |
|-------|-------|
| First stop (origin) | |
| Last stop (terminus) | |
| Endpoints evidence status | VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED |
| Endpoints evidence IDs | _(source/observation IDs that name both ends in this direction)_ |
| Published-source cross-check | Yes / No / Not performed |
| Endpoints notes | _(discrepancies, source limitations, field observation details)_ |

`PARTIALLY_VERIFIED` requires dated evidence identifying the route and both
endpoints for this direction. `VERIFIED` requires current authoritative
operator/official evidence for both endpoints. A field ride can be recorded as
field evidence, but does not mean endpoints were cross-checked against a
published source.

---

## Stop sequence

List stops in the order a passenger boards them, from origin to terminus.
One stop per row. Mark any stop you are uncertain about.

| # | Stop name | Certain? | Notes |
|---|-----------|----------|-------|
| 1 | _(origin)_ | Yes | First stop |
| 2 | | | |
| … | | | |
| N | _(terminus)_ | Yes | Last stop |

**Stop sequence evidence status:** VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED / UNKNOWN
**Sequence evidence IDs:** _(source/observation IDs that support the listed order)_

Use `PARTIALLY_VERIFIED` only for the specific segment/order supported by the
evidence. The full sequence can be `VERIFIED` only when evidence covers every
listed stop in order for this direction. A route-number directory entry is not
sequence evidence.

---

## Direction evidence

| Field | Value |
|-------|-------|
| Direction evidence status | VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED / UNKNOWN |
| Basis | _(e.g. "Rode the full route on YYYY-MM-DD" or "Confirmed with driver")_ |
| Evidence IDs | |

This status applies only to the direction recorded above. A return direction
requires a separate pattern and its own evidence; it is never inferred from the
listed sequence.
---

## Current operation

| Field | Value |
|-------|-------|
| Is the route currently operating? | Yes / No / Unknown |
| Last confirmed operating date | YYYY-MM-DD or UNKNOWN |
| Operating evidence status | VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED / UNKNOWN |
| Notes | _(e.g. seasonal, partial, changed frequency)_ |
| Evidence IDs | |

A field observation supports operation on its observation date only. Current
operation requires dated current operator/service evidence; historical
operation must remain `HISTORICAL`.

---

## Discrepancies with existing data

List any difference between what you observed and what `data/busData.json` currently records.

| Field | Current data | Observed | Action recommended |
|-------|-------------|----------|-------------------|
| Endpoints | | | |
| Stop order | | | |
| Stop names | | | |
| Other | | | |

---

## Recommended data update

```
# Changes to apply to data/busData.json after this verification:
# (Leave blank if no changes needed)

Bus number: 
confidence: high / medium / low
evidence.endpoints: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED
evidence.stopSequence: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED
evidence.direction: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED
evidence.currentOperation: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED / UNKNOWN

stops: [
  "Stop 1",
  "Stop 2",
  ...
]
```

Change `confidence` only after a separate comparison of published-source route
endpoints. Do not set it to `high` merely because the route was ridden or one
direction was observed. Update each `evidence` dimension independently and only
to the extent its cited evidence supports.

---

> [!CAUTION]
> Do not add a stop to the data file unless you have directly confirmed it
> (by riding the route or by a source that explicitly names the stop in sequence).
> Do not infer intermediate stops from maps — bus routes do not follow straight lines.

