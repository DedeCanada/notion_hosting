const PROTO_FILE = "transit.proto";
const FEED_URL = "https://translink-proxy.onrender.com/gtfsrealtime";

let stopCodeToId = {};
let routeShortNameToId = {};
let stopNameMap = {};
let stopLatLng = {};
let stopCodeMap = {}; // stop_id -> stop_code
let routeNameMap = {};
let STOP_ID = "NONE";
let ROUTE_ID = "ALL";
let liveBusEntries = [];
let map, stopMarker;

function getQueryParam(key, fallback = "") {
  const params = new URLSearchParams(window.location.search);
  return params.get(key) || fallback;
}

async function loadTransitData() {
  const [stopsText, routesText] = await Promise.all([
    fetch("stops.txt").then(res => res.text()),
    fetch("routes.txt").then(res => res.text())
  ]);

  stopsText.split("\n").forEach(line => {
    const [lat, wb, stop_code, lon, stop_id,,,, stop_name] = line.split(",");
    if (stop_id && stop_code && stop_id !== "stop_id") {
      const id = stop_id.trim();
      const code = stop_code.trim();
      stopCodeToId[code] = id;
      stopNameMap[id] = stop_name?.trim() || id;
      stopCodeMap[id] = code;
      stopLatLng[id] = [parseFloat(lat), parseFloat(lon)];
    }
  });

  routesText.split("\n").forEach(line => {
    const [long_name, , , , , route_id, , , short_name] = line.split(",");
    if (route_id && short_name && route_id !== "route_id") {
      routeShortNameToId[short_name.trim()] = route_id.trim();
      routeNameMap[route_id.trim()] = short_name?.trim() || route_id.trim();
    }
  });
}

function getStopIdFromCode(code) {
  return stopCodeToId[code] || "NONE";
}

function getRouteIdFromShort(name) {
  return routeShortNameToId[name] || "ALL";
}

function getStopName(stopId) {
  if (!stopId || stopId === "NONE") return "NONE";
  return stopNameMap[stopId] || `NOT FOUND ${stopId}`;
}

function getRouteName(routeId) {
  if (!routeId || routeId === "ALL") return "ALL";
  return routeNameMap[routeId] || `NOT FOUND ${routeId}`;
}

function formatUnixTime(unix) {
  if (!unix) return "Unknown";
  const date = new Date(unix * 1000);
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function timeUntil(unix) {
  if (!unix) return "N/A";
  let neg = "";
  let diffSeconds = Math.floor(unix - Date.now() / 1000);
  if (diffSeconds < 0) {
    neg = "-";
    diffSeconds = -diffSeconds;
  }
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `in ${neg}${minutes}m ${seconds}s`;
}

function formatDelay(seconds) {
  if (seconds === undefined || seconds === null) return "—";
  if (seconds === 0) return "on time";
  return (seconds > 0 ? "+" : "") + seconds + "s";
}

async function fetchBusTimes() {
  const response = await fetch(FEED_URL);
  const buffer = await response.arrayBuffer();

  const root = await protobuf.load(PROTO_FILE);
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  const message = FeedMessage.decode(new Uint8Array(buffer));

  liveBusEntries = [];

  for (const entity of message.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;

    const routeMatch = (ROUTE_ID === "ALL") || (tripUpdate.trip.routeId === ROUTE_ID);

    if (routeMatch) {
      for (const stu of tripUpdate.stopTimeUpdate) {
        const stopMatch = (STOP_ID === "NONE") || (stu.stopId === STOP_ID);

        if (stopMatch) {
          liveBusEntries.push({
            tripId: tripUpdate.trip.tripId,
            arrivalUnix: stu.arrival?.time,
            departureUnix: stu.departure?.time,
            arrivalDelay: stu.arrival?.delay,
            departureDelay: stu.departure?.delay,
            routeId: tripUpdate.trip.routeId
          });
        }
      }
    }
  }
}

function renderLiveCountdown() {
  const output = [];

  for (const entry of liveBusEntries) {
    output.push(
`Trip ID: ${entry.tripId}
Arrival: ${formatUnixTime(entry.arrivalUnix)} (${timeUntil(entry.arrivalUnix)})  Delay: ${formatDelay(entry.arrivalDelay)}
Departure: ${formatUnixTime(entry.departureUnix)} (${timeUntil(entry.departureUnix)})  Delay: ${formatDelay(entry.departureDelay)}
Route: ${getRouteName(entry.routeId)}
`);
  }

  document.getElementById("output").innerText = output.length
    ? output.join("\n")
    : "No upcoming buses for stop " + STOP_ID + " on route " + ROUTE_ID;
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function renderMapIfNeeded() {
  if (STOP_ID === "NONE") return;

  const coords = stopLatLng[STOP_ID];
  if (!coords) return;

  const [lat, lon] = coords;

  map = L.map("map").setView([lat, lon], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "Map data &copy; OpenStreetMap contributors"
  }).addTo(map);

  const selectedCode = stopCodeMap[STOP_ID] || STOP_ID;
  stopMarker = L.marker([lat, lon]).addTo(map)
    .bindPopup(`<b>${stopNameMap[STOP_ID] || STOP_ID}</b><br>Stop #${selectedCode}`);

  // Render nearby stops as small squares
  for (const [sid, scoords] of Object.entries(stopLatLng)) {
    if (sid === STOP_ID) continue;
    const dist = getDistanceFromLatLonInKm(lat, lon, scoords[0], scoords[1]);
    if (dist > 2) continue;

    const code = stopCodeMap[sid] || sid;
    L.marker([scoords[0], scoords[1]], {
      icon: L.divIcon({
        className: '',
        html: '<div style="width:10px;height:10px;background:#000;border:1px solid #fff;"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      }),
      interactive: true
    }).addTo(map)
      .bindPopup(`<b>${stopNameMap[sid] || sid}</b><br>Stop #${code}`);
  }
}

(async () => {
  const STOP_CODE = getQueryParam("stop", "NONE");
  const ROUTE_SHORT_NAME = getQueryParam("route", "ALL");

  await loadTransitData();

  STOP_ID = getStopIdFromCode(STOP_CODE);
  ROUTE_ID = getRouteIdFromShort(ROUTE_SHORT_NAME);

  let stopLabel = STOP_ID === "NONE" ? "ALL STOPS" : `${STOP_CODE} (${getStopName(STOP_ID)})`;
  let routeLabel = ROUTE_ID === "ALL" ? "ALL ROUTES" : `${ROUTE_SHORT_NAME}`;
  document.getElementById("stop-title").innerText =
    `Next Buses for Stop ${stopLabel} — Route ${routeLabel}`;


  await fetchBusTimes();
  renderLiveCountdown();

  if (STOP_ID !== "NONE") {
    await renderMapIfNeeded();
  } else {
    document.getElementById("map").classList.add("hidden");
  }

  setInterval(fetchBusTimes, 60000);
  setInterval(renderLiveCountdown, 1000);
})();
