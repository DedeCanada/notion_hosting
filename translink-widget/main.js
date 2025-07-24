const PROTO_FILE = "transit.proto";
const STOP_CODE = getParam("stop") || null;
const ROUTE_NAME = getParam("route") || null;
const FEED_URL = "https://translink-proxy.onrender.com/gtfsrealtime";
const POSITION_URL = "https://translink-proxy.onrender.com/gtfsposition";
const STOPS_TXT = "stops.txt";
const ROUTES_TXT = "routes.txt";

let stopCodeMap = {};
let routeShortNameMap = {};
let routeIdMap = {};
let stopLatLng = {};
let liveBusEntries = [];
let map, stopMarker, busMarkers = [];
let stopNameMap = {};
let routeLongNameMap = {};

function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadTransitData() {
  const [stopsText, routesText] = await Promise.all([
    fetch(STOPS_TXT).then(res => res.text()),
    fetch(ROUTES_TXT).then(res => res.text())
  ]);

  console.log(stopsText);
  console.log(routesText);

  stopsText.split("\n").forEach(line => {
    const [lat, , code, lon, id, , , , name] = line.split(",");
// stop_lat,,stop_code,stop_lon,stop_id,,,,stop_name,,
    if (id && name && id !== "stop_id") {
      stopNameMap[id.trim()] = name.trim();
      stopCodeMap[code?.trim()] = id.trim();
      stopLatLng[id.trim()] = [parseFloat(lat), parseFloat(lon)];
    }
  });

  routesText.split("\n").forEach(line => {
    const [longName,,,,, routeId,,, shortName] = line.split(",");
// route_long_name,,,,,route_id,,,route_short_name
    if (routeId && shortName && routeId !== "route_id") {
      routeLongNameMap[routeId.trim()] = longName.trim();
      routeShortNameMap[routeId.trim()] = shortName.trim();
      routeIdMap[shortName.trim()] = routeId.trim();
    }
  });

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

  console.log("Loaded stop map:", stopCodeMap);
  console.log("Loaded stop names:", stopNameMap);
  console.log("Loaded route map:", routeIdMap);
  console.log("Loaded route short names:", routeShortNameMap);
  console.log("Loaded route long names:", routeLongNameMap);
  console.log("Stop lat/lng map:", stopLatLng);
  if (typeof stopInfo !== "undefined") {
    console.log("Stop info:", stopInfo);
  }
}

function getStopIdFromCode(code) {
  return stopCodeMap[code] || null;
}

function getRouteIdFromShortName(name) {
  return routeIdMap[name] || null;
}

function getRouteShortName(routeId) {
  return routeShortNameMap[routeId] || null;
}

function getRouteLongName(routeId) {
  return routeLongNameMap[routeId] || null;
}

function getStopName(stopId) {
  return stopNameMap[stopId] || null;
}


function formatUnixTime(unix) {
  if (!unix) return "Unknown";
  return new Date(unix * 1000).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function timeUntil(unix) {
  if (!unix) return "N/A";
  let diff = Math.floor(unix - Date.now() / 1000);
  let neg = diff < 0 ? "-" : "";
  diff = Math.abs(diff);
  return `in ${neg}${Math.floor(diff / 60)}m ${diff % 60}s`;
}

function formatDelay(sec) {
  if (sec === undefined || sec === null) return "—";
  return sec === 0 ? "on time" : `${sec > 0 ? "+" : ""}${sec}s`;
}

function updatePageTitle(routeName, stopName) {
  routeTitle = routeName || "ALL";
  stopTitle = stopName || "NONE";
  title = `${stopTitle} (${routeTitle})`;
  document.title = title;
  document.getElementById("stop-title").innerText = title;
}

async function fetchBusTimes() {
  const stopId = getStopIdFromCode(STOP_CODE);
  const routeId = getRouteIdFromShortName(ROUTE_NAME);

  const response = await fetch(FEED_URL);
  const buffer = await response.arrayBuffer();
  const root = await protobuf.load(PROTO_FILE);
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  const message = FeedMessage.decode(new Uint8Array(buffer));

  const output = [];
  liveBusEntries = [];

  for (const entity of message.entity) {
    const tu = entity.tripUpdate;
    if (!tu) continue;

    if (routeId && tu.trip.routeId !== routeId) continue;

    for (const stu of tu.stopTimeUpdate) {
      if (stopId && stu.stopId !== stopId) continue;

      const arrivalUnix = stu.arrival?.time;
      const departureUnix = stu.departure?.time;

      liveBusEntries.push({
        tripId: tu.trip.tripId,
        routeId: tu.trip.routeId,
        arrivalUnix,
        departureUnix,
        arrivalDelay: stu.arrival?.delay,
        departureDelay: stu.departure?.delay,
      });

      output.push(
`${routeShortNameMap[tu.trip.routeId] || tu.trip.routeId}: ${formatUnixTime(arrivalUnix)} (${timeUntil(arrivalUnix)})`);
// Departure: ${formatUnixTime(departureUnix)} (${timeUntil(departureUnix)})  Delay: ${formatDelay(stu.departure?.delay)}
  // Delay: ${formatDelay(stu.arrival?.delay)}
  // Trip ID: ${tu.trip.tripId}
  // Route: ${routeShortNameMap[tu.trip.routeId] || tu.trip.routeId}
    }
  }

  document.getElementById("output").innerText = output.length
    ? output.join("\n")
    : `No buses for stop ${STOP_CODE || "ALL"} and route ${ROUTE_NAME || "ALL"}`;
}

async function renderMapIfNeeded() {
  const stopId = getStopIdFromCode(STOP_CODE);
  console.log("Stop ID from code:", stopId);
  if (!stopId) return; // No map unless stop provided

  const [lat, lon] = stopLatLng[stopId] || [49.28, -123.12];

  map = L.map("map").setView([lat, lon], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "Map data © OpenStreetMap contributors"
  }).addTo(map);

  stopMarker = L.marker([lat, lon])
    .addTo(map)
    .bindPopup(`Stop ${STOP_CODE}\nName ${getStopName(stopId)}`);
}

async function fetchAndRenderPositions() {
  if (!window.map || !window.L) return;

  // Clear existing vehicle markers
  if (window.vehicleLayerGroup) {
    window.vehicleLayerGroup.clearLayers();
  } else {
    window.vehicleLayerGroup = L.layerGroup().addTo(map);
  }

  const response = await fetch(POSITION_URL);
  const buffer = await response.arrayBuffer();
  const root = await protobuf.load(PROTO_FILE);
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  const message = FeedMessage.decode(new Uint8Array(buffer));
  const newMarkers = {};

  console.log("Decoded vehicle positions:", message);

  for (const entity of message.entity) {
    const vehicle = entity.vehicle;
    if (!vehicle || !vehicle.trip) continue;

    const vehicleRouteId = vehicle.trip.routeId?.trim();
    const vehicleLat = vehicle.position?.latitude;
    const vehicleLon = vehicle.position?.longitude;
    const vehicleId = vehicle.trip.tripId?.trim();

    if (!vehicleLat || !vehicleLon) continue;

    // ROUTE filter
    // if (ROUTE_ID && vehicleRouteId !== ROUTE_ID) continue;

    // STOP filter (optional proximity check to stop)
    stopLatLng[STOP_CODE] = stopLatLng[STOP_CODE] || null;
    if (STOP_CODE && stopInfo) {
      const stopLat = stopInfo.lat;
      const stopLon = stopInfo.lon;
      const dist = getDistanceFromLatLonInKm(vehicleLat, vehicleLon, stopLat, stopLon);
      if (dist > 2) continue; // skip if farther than 0.5km
    }

    console.log(`Rendering vehicle ${vehicleId} with direction ${vehicle.trip.directionId}`);
    if (vehicle.trip.directionId === 0) {
      theicon = L.icon({
          iconUrl: "https://cdn-icons-png.flaticon.com/512/1023/1023464.png",
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
      } else if (vehicle.trip.directionId === 1) {
      theicon = L.icon({
          iconUrl: "https://cdn-icons-png.flaticon.com/512/416/416739.png",
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
    } else {
      theicon = L.icon({
          iconUrl: "https://cdn-icons-png.flaticon.com/512/0/308.png",
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
    }

    const marker = L.marker([vehicleLat, vehicleLon], {
        icon: theicon
      }).addTo(map).bindPopup(`Bus ${vehicleId}\nRoute: ${getRouteShortName(vehicleRouteId) || "Unknown"}`);
      newMarkers[vehicleId] = marker;
    marker.addTo(window.vehicleLayerGroup);
  }
}

// Haversine distance check (~500m radius)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

(async () => {
  await loadTransitData();
  await fetchBusTimes();
  if (STOP_CODE) {
    await renderMapIfNeeded();
    await fetchAndRenderPositions();
  } else {
    document.getElementById("map").classList.add("hidden");
  }
  stopId = getStopIdFromCode(STOP_CODE);
  updatePageTitle(ROUTE_NAME, getStopName(stopId));

  setInterval(fetchBusTimes, 60000);
  setInterval(() => {
    fetchAndRenderPositions();
    renderLiveCountdown(); // optional
  }, 60000);
})();

function renderLiveCountdown() {
  const output = liveBusEntries.map(entry => (
    `${routeShortNameMap[entry.trip.routeId] || entry.trip.routeId}: ${formatUnixTime(arrivalUnix)} (${timeUntil(arrivalUnix)})`
  )).join("\n");
  
// `Trip ID: ${entry.tripId}
// Arrival: ${formatUnixTime(entry.arrivalUnix)} (${timeUntil(entry.arrivalUnix)})  Delay: ${formatDelay(entry.arrivalDelay)}
// Departure: ${formatUnixTime(entry.departureUnix)} (${timeUntil(entry.departureUnix)})  Delay: ${formatDelay(entry.departureDelay)}
// Route: ${routeShortNameMap[entry.routeId] || entry.routeId}
// `

  document.getElementById("output").innerText = output || 
  `No buses for stop ${STOP_CODE || "ALL"} and route ${ROUTE_NAME || "ALL"}`;
}
