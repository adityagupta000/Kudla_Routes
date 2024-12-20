const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path"); // Required to serve static files

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS for all routes

// Serve static files from the "frontend" directory
app.use(express.static(path.join(__dirname, "frontend")));

// Load bus data
const busData = JSON.parse(fs.readFileSync("./data/busData.json", "utf8"));

// Default route to serve the frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// Fetch bus details by ID
app.get("/bus/:busId", (req, res) => {
  const bus = busData.find((b) => b.id === parseInt(req.params.busId));
  if (bus) res.json(bus);
  else res.status(404).json({ error: "Bus not found" });
});

// Find buses between start and end stops
app.get("/route/:start/:end", (req, res) => {
  const { start, end } = req.params;
  const result = [];

  busData.forEach((bus) => {
    const startIndex = bus.routes.indexOf(start);
    const endIndex = bus.routes.indexOf(end);
    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
      result.push({
        busNumber: bus.busNumber,
        route: bus.routes.slice(startIndex, endIndex + 1),
      });
    }
  });

  if (result.length > 0) {
    res.json(result); // Return the bus routes
  } else {
    res.status(404).json({ error: "No buses found" }); // Return error if no routes are found
  }
});

// Start the server
const PORT = 5000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
