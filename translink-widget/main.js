const PROTO_FILE = "transit.proto";
const STOP_ID = getStopIdFromUrl();
const ROUTE_ID = getRouteIdFromUrl();
const FEED_URL = "https://translink-proxy.onrender.com/gtfs"; // Replace with your actual URL

let stopNameMap = {};
let routeNameMap = {};

async function loadTransitData() {
  const [stopsText, routesText] = await Promise.all([
    fetch("stops.txt").then(res => res.text()),
    fetch("routes.txt").then(res => res.text())
  ]);

  // Parse stops.txt
  stopsText.split("\n").forEach(line => {
    const [stop_id, stop_code, stop_name] = line.split(",");
    if (stop_id && stop_name && stop_id !== "stop_id") {
      stopNameMap[stop_id.trim()] = stop_name.trim();
    }
  });

  // Parse routes.txt
  routesText.split("\n").forEach(line => {
    const [route_id, agency_id, route_short_name, route_long_name] = line.split(",");
    if (route_id && route_short_name && route_id !== "route_id") {
      routeNameMap[route_id.trim()] = route_short_name.trim(); // or route_long_name
    }
  });
}

function getStopName(stopId) {
  if (!stopId || stopId === "NONE") return "NONE";
  return stopNameMap[stopId] || "NOT FOUND";
}

function getRouteName(routeId) {
  if (!routeId || routeId === "ALL") return "ALL";
  return routeNameMap[routeId] || "NOT FOUND";
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
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function timeUntil(unix) {
  if (!unix) return "N/A";
  let neg = ""
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
  // const text = await response.text();
  // console.log(text);


  const root = await protobuf.load(PROTO_FILE);
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

  const message = FeedMessage.decode(new Uint8Array(buffer));
  const output = [];
  console.log("Decoded GTFS message:", message);

  for (const entity of message.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;
    if (tripUpdate.trip.routeId === ROUTE_ID || ROUTE_ID === "ALL") {
      for (const stu of tripUpdate.stopTimeUpdate) {
        if (stu.stopId === STOP_ID) {
          const arrivalUnix = stu.arrival?.time;
          const departureUnix = stu.departure?.time;
      
          const arrival = formatUnixTime(arrivalUnix);
          const departure = formatUnixTime(departureUnix);
          const arrivalDelay = stu.arrival?.delay;
          const departureDelay = stu.departure?.delay;

          const stopName = getStopName(STOP_ID);
          const routeName = getRouteName(ROUTE_ID);
      
          output.push(
            `Trip ID: ${tripUpdate.trip.tripId}
            Arrival: ${arrival} (${timeUntil(arrivalUnix)})  Delay: ${formatDelay(arrivalDelay)}
            Departure: ${departure} (${timeUntil(departureUnix)})  Delay: ${formatDelay(departureDelay)}
            Route ID: ${tripUpdate.trip.routeId}
            \n`
          );
          console.log(tripUpdate)
        }
      }
    }
  }

  document.getElementById("output").innerText = output.length
    ? output.join("\n")
    : "No upcoming buses for stop " + STOP_ID;
}

(async () => {
  await loadTransitData();
  await fetchBusTimes();
  const stopName = getStopName(STOP_ID);
  const routeName = getRouteName(ROUTE_ID);
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("stop-title").innerText = `Next Buses for Stop ${stopName} (${routeName})`;
  });
  setInterval(fetchBusTimes, 60000);
})();
