/**
 * Mangalore bus finder — web server.
 * Serves the frontend and a small read-only JSON API. All the logic is in planner.js.
 */
const express = require("express");
const path = require("path");
const data = require("../data/busData.json");
const { createPlanner } = require("./planner");

const planner = createPlanner(data);
const app = express();

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "../frontend")));

const clean = (value) =>
  String(value ?? "")
    .trim()
    .slice(0, 60);

// Autocomplete. With no ?q= it returns the busiest stops.
app.get("/api/stops", (req, res) => {
  res.json(
    planner
      .search(clean(req.query.q))
      .map(({ stop, buses }) => ({ name: stop, buses })),
  );
});

// The main question: how do I get from A to B?
app.get("/api/plan", (req, res) => {
  const fromText = clean(req.query.from);
  const toText = clean(req.query.to);
  if (!fromText || !toText) {
    return res
      .status(400)
      .json({ error: "Enter a starting stop and a destination." });
  }

  const from = planner.resolve(fromText);
  const to = planner.resolve(toText);
  if (!from.stop || !to.stop) {
    const unknown = [
      !from.stop && `"${fromText}"`,
      !to.stop && `"${toText}"`,
    ].filter(Boolean);
    return res.status(404).json({
      error: `No stop found for ${unknown.join(" or ")}.`,
      suggestions: { from: from.suggestions || [], to: to.suggestions || [] },
    });
  }
  if (from.stop === to.stop) {
    return res
      .status(400)
      .json({ error: "Your start and destination are the same stop." });
  }

  const journeys = planner.plan(from.stop, to.stop);
  res.json({
    from: from.stop,
    to: to.stop,
    corrected: { from: from.corrected, to: to.corrected },
    journeys,
    ...(journeys.length === 0 ? { tryInstead: planner.busiestStops() } : {}),
  });
});

app.get("/api/buses", (req, res) => res.json(planner.listBuses()));

app.get("/api/bus/:number", (req, res) => {
  const bus = planner.getBus(req.params.number);
  if (!bus)
    return res
      .status(404)
      .json({ error: `No bus numbered ${req.params.number}.` });
  res.json(bus);
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Bus finder running at http://localhost:${port}`),
  );
}

module.exports = { app, planner };
