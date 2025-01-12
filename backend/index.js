const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, "frontend")));

const busData = JSON.parse(fs.readFileSync("./data/busData.json", "utf8"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

app.get("/bus/:busId", (req, res) => {
  const bus = busData.find((b) => b.id === parseInt(req.params.busId));
  if (bus) res.json(bus);
  else res.status(404).json({ error: "Bus not found" });
});

app.get("/route/:start/:end", (req, res) => {
  const start = req.params.start.toLowerCase();
  const end = req.params.end.toLowerCase();
  const result = [];

  busData.forEach((bus) => {
    const lowerRoutes = bus.routes.map((route) => route.toLowerCase());

    const startIndex = lowerRoutes.indexOf(start);
    const endIndex = lowerRoutes.indexOf(end);

    if (startIndex !== -1 && endIndex !== -1) {
      if (startIndex < endIndex) {
        result.push({
          busNumber: bus.busNumber,
          route: bus.routes.slice(startIndex, endIndex + 1),
          direction: "forward",
        });
      }
      // Reverse direction
      if (startIndex > endIndex) {
        result.push({
          busNumber: bus.busNumber,
          route: bus.routes.slice(endIndex, startIndex + 1).reverse(),
          direction: "reverse",
        });
      }
    }
  });

  if (result.length > 0) {
    res.json(result);
  } else {
    res.status(404).json({ error: "No buses found" });
  }
});

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
