# notion_hosting

Notion-embeddable widgets hosted on GitHub Pages.

**Base URL:** `https://dedecanada.github.io/notion_hosting/`

---

## Widgets

### 📅 Timeline
A Notion-style timeline chart with encrypted cloud storage via Firebase.

**[Open Timeline](https://dedecanada.github.io/notion_hosting/timeline-widget/)**

**Features:**
- Items with name, start/end date, category, color, and description
- Categories pack items into rows (no overlapping bars)
- Drag to pan, zoom in/out, scroll to today
- View mode (click → popup) and Edit mode (click → full edit)
- Table mode for bulk editing
- Import / Export as CSV

**Usage in Notion:**
```
https://dedecanada.github.io/notion_hosting/timeline-widget/?pass=YOUR_KEY
```
Each passphrase maps to a separate encrypted dataset. Data is AES-256 encrypted client-side before reaching Firebase — the URL is safe to embed.

**Firebase setup (one-time):**
1. [firebase.google.com](https://firebase.google.com) → New project → Realtime Database → Start in test mode
2. Paste your database URL into `timeline-widget/main.js` at the top
3. In Firebase Console → Realtime Database → Rules, publish:
```json
{ "rules": { ".read": true, ".write": true } }
```

---

### 🚌 TransLink Bus Times
Real-time TransLink bus arrivals for a given stop, with a live map showing nearby stops.

**[Open TransLink Widget](https://dedecanada.github.io/notion_hosting/translink-widget/)**

**URL parameters:**
- `?stop=XXXXX` — 5-digit stop code
- `?route=NNN` — filter by route number (optional)

**Example:**
```
https://dedecanada.github.io/notion_hosting/translink-widget/?stop=61522&route=17
```

---

### 🚌 Bus Widget
Updated version of the TransLink widget with improved map and stop markers.

**[Open Bus Widget](https://dedecanada.github.io/notion_hosting/bus-widget/)**

Same URL parameters as the TransLink widget above.

---

### 🗺️ TransLink Map
Live map of TransLink vehicles and stops using GTFS-RT data.

**[Open TransLink Map](https://dedecanada.github.io/notion_hosting/map-widget/)**

---

### 🗺️ Custom Map Widget
A customizable Leaflet map with configurable markers loaded from `data.json`.

**[Open Custom Map](https://dedecanada.github.io/notion_hosting/custom-map-widget/)**

---

### 🚇 MTA Subway Times
Real-time NYC subway arrivals for a given stop, with a live map showing train positions.

**[Open MTA Widget](https://dedecanada.github.io/notion_hosting/mta-widget/)**

**URL parameters:**
- `?stop=XXX` — MTA stop ID (e.g. `127` for Times Sq-42 St)
- `?route=X` — filter by line (e.g. `1`, `A`, `N`)
- `?dir=uptown` or `?dir=downtown` — filter by direction

**Example:**
```
https://dedecanada.github.io/notion_hosting/mta-widget/?stop=127&route=1&dir=uptown
```

---

### 📈 UBC BigWay Line Monitor
Monitors the UBC 99 B-Line using Chart.js to visualize stop data over time.

**[Open BigWay Line](https://dedecanada.github.io/notion_hosting/bigway-line/)**

---

### 🌤️ Weather Widget
Vancouver weather via weatherwidget.io.

**[Open Weather Widget](https://dedecanada.github.io/notion_hosting/weather-widget/)**

---

### 🎮 Clicker Game
A simple clicker game widget.

**[Open Clicker Game](https://dedecanada.github.io/notion_hosting/game-widget/)**
