const STOP_CODE = getUrlParam("stop");
const ROUTE_SHORT_NAME = getUrlParam("route");
console.log("Stop code:", STOP_CODE, "Route short name:", ROUTE_SHORT_NAME);
const STOPS_TXT = "stops.txt";
const ROUTES_TXT = "routes.txt";
const VEHICLE_FEED_URL = "https://translink-proxy.onrender.com/gtfsposition";

let stopInfo = null;
let routeId = null;
let stopMap = {};       // { stop_id: {lat, lon, stop_code, stop_name} }
let routeStops = new Set();
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

  // Parse stops
  stopsText.trim().split("\n").forEach(line => {
    const cols = line.split(",");
    const stop_lat = cols[0], stop_code = cols[2], stop_lon = cols[3], stop_id = cols[4];
    const stop_name = cols[8];
    if (!stop_id || stop_id === "stop_id") return;

    stopMap[stop_id] = {
      stop_id,
      stop_code,
      stop_name,
      lat: parseFloat(stop_lat),
      lon: parseFloat(stop_lon)
    };

    if (STOP_CODE && stop_code === STOP_CODE) {
      stopInfo = stopMap[stop_id];
    }
  });

  // Parse routes
  routesText.trim().split("\n").forEach(line => {
    const cols = line.split(",");
    if (ROUTE_SHORT_NAME && cols[8] === ROUTE_SHORT_NAME) {
      routeId = cols[5];
    }
  });

  const center = stopInfo
    ? [stopInfo.lat, stopInfo.lon]
    : [49.2827, -123.1207]; // Vancouver default center

  initMap(center);
  renderStopMarkers();
  fetchAndRenderBuses();
  setInterval(fetchAndRenderBuses, 30000);
}

function initMap(center) {
  map = L.map("map").setView(center, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function renderStopMarkers() {
  let filteredStops = Object.values(stopMap);

  if (stopInfo) {
    filteredStops = [stopInfo]; // Show only selected stop
  } else if (routeId) {
    // Show only stops used by this route (assume all stops if you don’t have stop_times.txt)
    filteredStops = filteredStops.filter(s => true); // fallback: show all stops
  }

  filteredStops.forEach(stop => {
    L.marker([stop.lat, stop.lon], {
      icon: L.icon({
        iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })
    }).addTo(map).bindPopup(`Stop: ${stop.stop_name} (${stop.stop_code})`);
  });

  console.log("✅ Stop markers rendered");
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

    if (!lat || !lon) return;

    if (routeId && tripRouteId !== routeId) return;
    if (stopInfo && !isNearStop(lat, lon, stopInfo.lat, stopInfo.lon)) return;

    if (busMarkers[id]) {
      busMarkers[id].setLatLng([lat, lon]);
      newMarkers[id] = busMarkers[id];
    } else {
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

  for (const id in busMarkers) {
    if (!newMarkers[id]) {
      map.removeLayer(busMarkers[id]);
    }
  }

  busMarkers = newMarkers;
}

// Haversine distance check (~500m)
function isNearStop(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c < 500;
}

loadStopAndRouteData();
