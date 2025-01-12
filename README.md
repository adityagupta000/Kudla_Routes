# Bus Route Management Application

This project is a comprehensive bus route management system that allows users to find buses between stops, view routes, and manage real-time bus queues. The project includes a backend built with Node.js and Express, and a responsive frontend with HTML, CSS, and JavaScript.

---

## File Structure

```
bus_route/
├── backend/
│   ├── app.js                   # Main backend server
│   ├── data/
│   │   └── busData.json         # Bus data in JSON format
│   ├── frontend/
│   │   ├── index.html          # Main HTML file
│   │   ├── script.js           # Frontend JavaScript
│   │   └── style.css           # Stylesheet for frontend
│   ├── utils/
│   │   ├── graphUtils.js       # Utility for graph operations
│   │   └── queueUtils.js       # Utility for queue operations
└── README.md                   # Documentation for the project
```

---

## Features

- **Search Bus Routes**: Find buses and routes between two stops.
- **Shortest Path**: Identify the shortest path between stops.
- **Responsive Frontend**: Interactive and mobile-friendly UI.

---

## Setup Instructions

### Prerequisites

- [Node.js](https://nodejs.org/) installed on your machine.

### Steps

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd bus_route
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node backend/app.js
   ```
4. Open the application in your browser:
   ```
   http://localhost:3000
   ```

---

## Usage

### Searching for Bus Routes

1. Enter the **start stop** and **end stop** in the search fields.
2. Click on the **Find Route** button.
3. View the available buses and their routes.

### Real-Time Queue Management

1. Use the `/realtime/:busId` endpoint to manage the queue for a specific bus.
2. **POST** request to add stops to the queue.
3. **GET** request to retrieve the current queue.

---

## Example Bus Data

```json
[
  {
    "id": 1,
    "busNumber": "Bus no: 1",
    "from": "State Bank",
    "to": "Kunjathbail",
    "routes": [
      "State Bank",
      "Car Street",
      "Mannagudda",
      "Ladyhill",
      "Chilimbi",
      "Urva Stores",
      "Kavoor",
      "MCF colony",
      "Kunjathbail"
    ]
  }
]
```

---

## API Endpoints

### `/bus/:busId`

- **GET**: Fetch details of a specific bus by ID.

### `/route/:start/:end`

- **GET**: Find buses between two stops.

### `/shortest_path/:start/:end`

- **GET**: Find the shortest path between two stops.

### `/realtime/:busId`

- **POST**: Add a stop to the real-time queue.
- **GET**: Retrieve the current queue for a bus.

---

## Used

- **Backend**: Node.js, Express
- **Frontend**: HTML, CSS, JavaScript
- **Utilities**: Graph and Queue operations
