const { Graph } = require("graph-data-structure");

// Build the graph using bus routes
function buildGraph(busData) {
  const graph = new Graph();
  busData.forEach((bus) => {
    for (let i = 0; i < bus.routes.length - 1; i++) {
      graph.addEdge(bus.routes[i], bus.routes[i + 1], {
        busNumber: bus.busNumber,
      });
    }
  });
  return graph;
}

// Find shortest path between two stops
function shortestPath(graph, start, end) {
  try {
    return graph.shortestPath(start, end);
  } catch (err) {
    return "No path found";
  }
}

module.exports = { buildGraph, shortestPath };
