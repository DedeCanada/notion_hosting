const PROTO_FILE = "transit.proto";
const STOP_ID = getStopIdFromUrl();
const ROUTE_ID = getRouteIdFromUrl();
const FEED_URL = "https://translink-proxy.onrender.com/gtfs"; // Replace with your actual URL

let stopNameMap = {};
let routeNameMap = {};
let liveBusEntries = []; // stores { tripId, arrivalUnix, departureUnix, routeId }

async function loadTransitData() {
  const [stopsText, routesText] = await Promise.all([
    fetch("stops.txt").then((res) => res.text()),
    fetch("routes.txt").then((res) => res.text()),
  ]);

  // Parse stops.txt
  stopsText.split("\n").forEach((line) => {
    const [
      stop_lat,
      wheelchair_boarding,
      stop_code,
      stop_lon,
      stop_id,
      stop_url,
      parent_station,
      stop_desc,
      stop_name,
      location_type,
      zone_id,
    ] = line.split(",");
    if (stop_id && stop_name && stop_id !== "stop_id") {
      stopNameMap[stop_id.trim()] = stop_name.trim();
    }
  });

  // Parse routes.txt
  routesText.split("\n").forEach((line) => {
    const [
      route_long_name,
      route_type,
      route_text_color,
      route_color,
      agency_id,
      route_id,
      route_url,
      route_desc,
      route_short_name,
    ] = line.split(",");
    if (route_id && route_short_name && route_id !== "route_id") {
      routeNameMap[route_id.trim()] = route_short_name.trim(); // or route_long_name
    }
  });
}

function getStopName(stopId) {
  if (!stopId || stopId === "NONE") return "NONE";
  return stopNameMap[stopId] || `NOT FOUND ${stopId}`;
}

function getRouteName(routeId) {
  if (!routeId || routeId === "ALL") return "ALL";
  return routeNameMap[routeId] || `NOT FOUND ${routeId}`;
}

// document.addEventListener("DOMContentLoaded", () => {
//   document.getElementById("stop-title").innerText = `Next Buses for Stop ${STOP_ID} (${ROUTE_ID})`;
// });

function getStopIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("stop") || "NONE"; // default fallback
}

function getRouteIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("route") || "ALL"; // default fallback
}

function formatUnixTime(unix) {
  if (!unix) return "Unknown";
  const date = new Date(unix * 1000); // UNIX timestamp is in seconds
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
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

  liveBusEntries = []; // ✅ Reset only ONCE per fetch

  for (const entity of message.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;

    const routeId = tripUpdate.trip.routeId;

    if (routeId === ROUTE_ID || ROUTE_ID === "ALL") {
      for (const stu of tripUpdate.stopTimeUpdate) {
        const stopId = stu.stopId;

        if (stopId === STOP_ID || STOP_ID === "NONE") {
          const arrivalUnix = stu.arrival?.time;
          const departureUnix = stu.departure?.time;
          const arrivalDelay = stu.arrival?.delay;
          const departureDelay = stu.departure?.delay;

          liveBusEntries.push({
            tripId: tripUpdate.trip.tripId,
            stopId,
            routeId,
            arrivalUnix,
            departureUnix,
            arrivalDelay,
            departureDelay,
            routeId,
          });
        }
      }
    }
  }

  // If you want to immediately render once after fetch
  renderLiveCountdown();
}

function renderLiveCountdown() {
  if (liveBusEntries.length === 0) {
    document.getElementById("output").innerText =
      "No upcoming buses for stop " + STOP_ID;
    return;
  }

  const output = [];

  for (const entry of liveBusEntries) {
    output.push(
      // Trip ID: ${entry.tripId}
      `Stop: ${getStopName(entry.stopId)}\n`+
      `Route: ${getRouteName(entry.routeId)}\n`+
      `Arrival: ${formatUnixTime(entry.arrivalUnix)} (${timeUntil(entry.arrivalUnix)}) \t Delay: ${formatDelay(entry.arrivalDelay)}\n`+
      `Departure: ${formatUnixTime(entry.departureUnix)} (${timeUntil(entry.departureUnix)}) \t Delay: ${formatDelay(entry.departureDelay)}\n`
    );
  }

  document.getElementById("output").innerText = output.join("\n");
}

(async () => {
  await loadTransitData();
  await fetchBusTimes();
  const stopName = getStopName(STOP_ID);
  const routeName = getRouteName(ROUTE_ID);
  document.getElementById(
    "stop-title"
  ).innerText = `Next Buses for Stop ${stopName} (${routeName})`;
  setInterval(fetchBusTimes, 30000);
  setInterval(renderLiveCountdown, 1000); // Update countdown every second
})();
