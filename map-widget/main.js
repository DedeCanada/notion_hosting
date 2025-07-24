const STOP_CODE = getUrlParam("stop");
const ROUTE_SHORT_NAME = getUrlParam("route");
console.log("Stop code:", STOP_CODE, "Route short name:", ROUTE_SHORT_NAME);
const STOPS_TXT = "stops.txt";
const ROUTES_TXT = "routes.txt";
const VEHICLE_FEED_URL = "https://translink-proxy.onrender.com/gtfsposition";

let stopInfo = null;
let routeId = null;
let map, stopMarker, busMarkers = {};

function getUrlParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadStopAndRouteData() {
  const [stopsText, routesText] = await Promise.all([
    fetch(STOPS_TXT).then(r => r.text()),
    fetch(ROUTES_TXT).then(r => r.text())
  ]);
  console.log(stopsText, routesText);
  console.log(STOP_CODE, ROUTE_SHORT_NAME);

  // Parse stops
  stopsText.split("\n").forEach(line => {
    const cols = line.split(",");
    const stop_code = cols[2], stop_id = cols[4];
    const stop_name = cols[8], stop_lat = cols[0], stop_lon = cols[3];
    // console.log("Checking stop:", stop_code);
    if (STOP_CODE && stop_code === STOP_CODE) {
      stopInfo = {
        stop_id,
        stop_code,
        stop_name,
        lat: parseFloat(stop_lat),
        lon: parseFloat(stop_lon)
      };
    }
  });

  // Parse routes
  routesText.split("\n").forEach(line => {
    const cols = line.split(",");
    // console.log("Checking route short name:", cols[8]);
    if (ROUTE_SHORT_NAME && cols[8] === ROUTE_SHORT_NAME) {
      routeId = cols[5];
    }
  });

  // Default map center
  const center = stopInfo ? [stopInfo.lat, stopInfo.lon] : [49.2827, -123.1207]; // Vancouver

  initMap(center);
  fetchAndRenderBuses();
  setInterval(fetchAndRenderBuses, 30000);
}

function initMap(center) {
  map = L.map("map").setView(center, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  if (stopInfo) {
    stopMarker = L.marker([stopInfo.lat, stopInfo.lon], {
      icon: L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/14025/14025061.png",
        iconSize: [30, 30],
        iconAnchor: [15, 30]
      })
    }).addTo(map).bindPopup(`Stop: ${stopInfo.stop_name}`);
  }
}

async function fetchAndRenderBuses() {
  const response = await fetch(VEHICLE_FEED_URL);
  const buffer = await response.arrayBuffer();

  const root = await protobuf.load("transit.proto");
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  const message = FeedMessage.decode(new Uint8Array(buffer));

  const newMarkers = {};

  message.entity.forEach(entity => {
    const vehicle = entity.vehicle;
    if (!vehicle) return;

    const id = vehicle.vehicle?.id || vehicle.trip?.tripId;
    const lat = vehicle.position?.latitude;
    const lon = vehicle.position?.longitude;
    const tripRouteId = vehicle.trip?.routeId;

    if (!lat || !lon) { console.log("Missing lat/lon for entity:", entity); return; }

    // Filter logic
    if (routeId && tripRouteId !== routeId) { console.log(`Skipping bus ${id} due to route mismatch`); return; }
    if (stopInfo && !isNearStop(lat, lon, stopInfo.lat, stopInfo.lon)) { console.log(`Skipping bus ${id} not near stop`); return; }

    if (busMarkers[id]) {
      busMarkers[id].setLatLng([lat, lon]);
      newMarkers[id] = busMarkers[id];
    } else {
      // console.log(`Adding marker for bus ${id} at (${lat}, ${lon})`);
    const marker = L.marker([lat, lon], {
        icon: L.icon({
          iconUrl: "https://cdn-icons-png.flaticon.com/512/0/308.png",
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        })
      }).addTo(map).bindPopup(`Bus ${id}\nRoute: ${tripRouteId || "Unknown"}`);
      newMarkers[id] = marker;
    }
  });

  // Remove old markers
  for (const id in busMarkers) {
    if (!newMarkers[id]) {
      map.removeLayer(busMarkers[id]);
    }
  }

  busMarkers = newMarkers;
}

async function renderStopMarkers(map) {
  const response = await fetch("stops.txt");
  const text = await response.text();

  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  const latIndex = header.indexOf("stop_lat");
  const lonIndex = header.indexOf("stop_lon");
  const nameIndex = header.indexOf("stop_name");

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const lat = parseFloat(parts[latIndex]);
    const lon = parseFloat(parts[lonIndex]);
    const name = parts[nameIndex];

    if (!isNaN(lat) && !isNaN(lon)) {
      L.marker([lat, lon], { icon: L.icon({
        iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })})
      .addTo(map)
      .bindPopup(name);
    }
  }

  console.log("✅ Stop markers rendered");
}

// Haversine distance check (~500m radius)
function isNearStop(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c < 500; // true if within 500 meters
}

loadStopAndRouteData();
