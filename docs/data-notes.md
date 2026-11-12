# Data notes

What was checked in `data/busData.json`, what was fixed, and what is still unconfirmed.

**Short version:** the bus numbers and the two ends of each route were checked against two public
sources and mostly agree. The stops in between could **not** be confirmed online. No source is
perfect, and no official feed exists (Mangalore city buses are run by private operators), so the
data cannot honestly be called "100% correct". Each bus carries a `confidence` field so the app
can say how much to trust it.

## 1. Online check (route numbers and route ends)

Every one of the 99 buses was compared with:

- Wikipedia, "Mangaluru City Bus routes": https://en.wikipedia.org/wiki/Mangaluru_City_Bus_routes
- Mangalore local bus list: https://mangaloreindia.blogspot.com/p/local-bus-transport.html

A bus counts as matching a source when that source lists the same number with the same start and end
(spelling variants and "Bondel via Kavoor" style wording counted as agreeing). The pages were read
with an automated page reader, so treat this as a strong indicator, not an audit.

| `confidence` | Meaning                                     | Buses |
| ------------ | ------------------------------------------- | ----- |
| `high`       | Both sources agree on the route ends        | 49    |
| `medium`     | One source agrees                           | 25    |
| `low`        | Neither agrees, or the number is not listed | 25    |

The 25 `low` buses (check these first): 1C, 2D, 2F, 3, 3B, 10B, 12A, 13E, 14B, 22A, 30A, 30B, 31A,
41A, 43, 45A, 45B, 45E, 45F, 47B, 48, 48A, 53, 53A, 54A.

Where the two sources disagree with _each other_ (for example 13C and 13D are swapped on the local
list), the data was left as it was and the bus is `medium`.

In the app, a leg that uses several identical-road buses (like 47B / 47C) shows the confidence of
its weakest bus.

## 2. What could not be confirmed

- **Stops in between.** Spot-checked 8 routes (1, 10A, 12A, 15, 17, 27, 45, 51) against the local
  list. All 8 differ: its lists are shorter and name different intermediate stops (for example it
  routes 12A via Bunts Hostel, Nantoor, Kudpu Temple and Vamanjuru, while this data goes via Jyothi,
  Kadri, Kulshekar and Gurupura). Neither list is proven right. The app says "route ends match" and
  never claims the middle stops are confirmed.
- **Numbering.** Wikipedia shows an older and a newer numbering scheme side by side. The numbers in
  this dataset are the older ones. Check which numbers are painted on buses today.
- **Currency.** The local list itself says: "there may be changes in the given list of City buses
  and their numbers" and advises riders to "check for the places to go with the bus conductor before
  boarding a bus". The app footer says the same.
- **Direction.** The data lists one direction per bus. The planner assumes every bus also runs the
  other way.

## 3. Fixes made to the original file

- **Spelling variants merged (209 names down to 186).** The same place was spelled several ways, so a
  rider could never change buses there. Examples: Lal Bagh / Lalbagh, Kankanadi / Kankanady,
  Urva Store / Urva Stores, Kaatipalla / Katipalla, Nantoor / Nanthur, Mangaldevi / Mangaladevi.
  Every old spelling still works when typed (`aliases` in the data file).
- **`from` / `to` removed.** Nine buses had a `from` or `to` that contradicted their own stop list
  (10A, 11A, 13A, 13D, 22A, 33, 3C, 47B, 9B). Both are now read from the first and last stop.
- Bus 9B's extra last stop "Railway Junction" removed, because both sources end it at J.M. Road.
- Bus 10A repeated "Adyar" and ended in "Launch Jetty"; now one "Adyar" and "Adyar Launch Jetty".
- "K.P.T. Yeyyady" (bus 64) was two stops in one: now KPT and Yeyyadi.
- Typos: "First nureo" is now First Neuro, and stray trailing spaces and punctuation are gone
  (97 entries had them).
- "Bajpe Aerodrome" is now Bajpe Airport (also found by typing airport, IXE, or Mangalore Airport).
- Bus numbers are plain ("45A", not "Bus no: 45A ").
- `npm test` now fails if any of these mistakes come back.

## 4. Judgment calls (worth a second look)

Merged because it is clearly the same word: Nantoor and Nanthur Cross into Nanthur, Vamanjuru into
Vamanjoor, Padeel into Padil.

Left separate because they might be different stops. If you know they are the same, add an alias
in the data file and merge them, and transfers will start working there:

- Kadri / Kadri Market / Kadri Temple
- Bejai / Bejai Church / Bejai Museum
- Kottara / Kottara Cross / Kottara Chowki
- Padangady / Padavinangadi (in bus 13D, Padangady comes _after_ Bondel; in 14A it comes _before_)
- Kulshekar / Kulshekar Chowki, Urva Stores / Urva Market, Bajpe / Bajpe Airport

Sources name the end of 22A and 47B as Adyapady (on the Bajpe airport road); here they end at
Bajpe Airport.

## 5. How to make the data better

1. Ride the `low` buses and note the real start, end and stops.
2. Edit `data/busData.json` and set `confidence` to `high` once you have seen it yourself.
3. Run `npm test` from the project root to catch duplicates and spelling mix-ups.
