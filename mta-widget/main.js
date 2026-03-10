const PROTO_FILE = "transit.proto";
const STOP_ID = getParam("stop") || null;   // e.g. "127" for Times Sq-42 St
const ROUTE_NAME = getParam("route") || null; // e.g. "1", "A", "N"
const DIRECTION = getParam("dir") || null;   // "uptown" or "downtown"
const STOPS_TXT = "stops.txt";
const ROUTES_TXT = "routes.txt";

// MTA GTFS-RT feeds by line group
const FEED_URLS = {
  "123456S":  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "ACE":      "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  "BDFM":     "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  "G":        "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  "JZ":       "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  "NQRW":     "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  "L":        "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
  "SI":       "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si"
};

// Map route_id to its feed group
const ROUTE_TO_FEED = {};
"1,2,3,4,5,6,7,GS,FS,H".split(",").forEach(r => ROUTE_TO_FEED[r] = "123456S");
"A,C,E".split(",").forEach(r => ROUTE_TO_FEED[r] = "ACE");
"B,D,F,M".split(",").forEach(r => ROUTE_TO_FEED[r] = "BDFM");
"G".split(",").forEach(r => ROUTE_TO_FEED[r] = "G");
"J,Z".split(",").forEach(r => ROUTE_TO_FEED[r] = "JZ");
"N,Q,R,W".split(",").forEach(r => ROUTE_TO_FEED[r] = "NQRW");
"L".split(",").forEach(r => ROUTE_TO_FEED[r] = "L");
"SI,SS".split(",").forEach(r => ROUTE_TO_FEED[r] = "SI");

// Route colors (official MTA colors)
const ROUTE_COLORS = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  "A": "#0039A6", "C": "#0039A6", "E": "#0039A6",
  "B": "#FF6319", "D": "#FF6319", "F": "#FF6319", "M": "#FF6319",
  "G": "#6CBE45",
  "J": "#996633", "Z": "#996633",
  "L": "#A7A9AC",
  "N": "#FCCC0A", "Q": "#FCCC0A", "R": "#FCCC0A", "W": "#FCCC0A",
  "S": "#808183", "GS": "#808183", "FS": "#808183", "H": "#808183",
  "SI": "#003DA5", "SS": "#003DA5"
};

let stopNameMap = {};
let stopLatLng = {};
let stopParentMap = {};   // child stop_id -> parent stop_id
let stopChildrenMap = {}; // parent stop_id -> [child stop_ids]
let routeMap = {};        // route_id -> { short_name, long_name, color }
let liveBusEntries = [];
let map, stopMarker;

function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadTransitData() {
  const [stopsText, routesText] = await Promise.all([
    fetch(STOPS_TXT).then(res => res.text()),
    fetch(ROUTES_TXT).then(res => res.text())
  ]);

  // Parse stops: stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
  stopsText.split("\n").forEach(line => {
    const cols = line.split(",");
    if (cols.length < 5 || cols[0] === "stop_id") return;
    const [stop_id, stop_name, stop_lat, stop_lon, location_type, parent_station] = cols;
    const id = stop_id.trim();
    const name = stop_name.trim();

    stopNameMap[id] = name;
    stopLatLng[id] = [parseFloat(stop_lat), parseFloat(stop_lon)];

    if (parent_station && parent_station.trim()) {
      stopParentMap[id] = parent_station.trim();
      if (!stopChildrenMap[parent_station.trim()]) {
        stopChildrenMap[parent_station.trim()] = [];
      }
      stopChildrenMap[parent_station.trim()].push(id);
    }
  });

  // Parse routes: route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color,route_sort_order
  routesText.split("\n").forEach(line => {
    const cols = line.split(",");
    if (cols.length < 4 || cols[0] === "route_id") return;
    const route_id = cols[0].trim();
    const short_name = cols[2].trim();
    const long_name = cols[3].trim();
    const color = cols[7] ? cols[7].trim() : "";
    routeMap[route_id] = { short_name, long_name, color };
  });

  console.log("Loaded stops:", Object.keys(stopNameMap).length);
  console.log("Loaded routes:", Object.keys(routeMap).length);
}

// Get stop_ids to match, filtered by direction if specified
function getStopIdsForStop(parentId) {
  if (!parentId) return [];
  const children = stopChildrenMap[parentId] || [];
  const ids = children.length > 0 ? children : [parentId];

  if (DIRECTION) {
    const suffix = DIRECTION.toLowerCase() === "uptown" ? "N" : "S";
    const filtered = ids.filter(id => id.endsWith(suffix));
    return filtered.length > 0 ? filtered : ids;
  }
  return ids;
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

function getRouteName(routeId) {
  const r = routeMap[routeId];
  return r ? r.short_name : routeId;
}

function updatePageTitle(routeName, stopName) {
  const routeTitle = routeName || "ALL";
  const stopTitle = stopName || "ALL";
  const dirLabel = DIRECTION ? ` - ${DIRECTION.charAt(0).toUpperCase() + DIRECTION.slice(1)}` : "";
  const title = `${stopTitle} (${routeTitle})${dirLabel}`;
  document.title = title;
  document.getElementById("stop-title").innerText = title;
}

// Determine which feeds to query
function getFeedUrlsToQuery() {
  if (ROUTE_NAME) {
    const group = ROUTE_TO_FEED[ROUTE_NAME.toUpperCase()];
    if (group) return [FEED_URLS[group]];
  }
  // Query all feeds
  return Object.values(FEED_URLS);
}

async function fetchFeed(url) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const root = await protobuf.load(PROTO_FILE);
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  return FeedMessage.decode(new Uint8Array(buffer));
}

async function fetchSubwayTimes() {
  const stopIds = getStopIdsForStop(STOP_ID);
  const stopIdSet = new Set(stopIds);
  const feedUrls = getFeedUrlsToQuery();

  const output = [];
  liveBusEntries = [];

  try {
    const feeds = await Promise.all(feedUrls.map(url => fetchFeed(url).catch(e => {
      console.warn("Feed error:", url, e);
      return null;
    })));

    for (const message of feeds) {
      if (!message) continue;

      for (const entity of message.entity) {
        const tu = entity.tripUpdate;
        if (!tu) continue;

        const routeId = tu.trip?.routeId;
        if (ROUTE_NAME && routeId !== ROUTE_NAME.toUpperCase()) continue;

        for (const stu of tu.stopTimeUpdate || []) {
          if (STOP_ID && !stopIdSet.has(stu.stopId)) continue;

          const arrivalUnix = stu.arrival?.time?.low || stu.arrival?.time;
          const departureUnix = stu.departure?.time?.low || stu.departure?.time;
          const arrTime = typeof arrivalUnix === 'object' ? arrivalUnix.toNumber?.() || 0 : arrivalUnix;
          const depTime = typeof departureUnix === 'object' ? departureUnix.toNumber?.() || 0 : departureUnix;

          // Skip arrivals in the past (more than 60s ago)
          if (arrTime && arrTime < Date.now() / 1000 - 60) continue;

          const direction = stu.stopId?.endsWith("N") ? "Uptown" : stu.stopId?.endsWith("S") ? "Downtown" : "";

          // Filter by direction parameter
          if (DIRECTION && direction.toLowerCase() !== DIRECTION.toLowerCase()) continue;

          liveBusEntries.push({
            tripId: tu.trip.tripId,
            routeId: routeId,
            stopId: stu.stopId,
            arrivalUnix: arrTime,
            departureUnix: depTime,
            direction: direction
          });
        }
      }
    }

    // Sort by arrival time
    liveBusEntries.sort((a, b) => (a.arrivalUnix || Infinity) - (b.arrivalUnix || Infinity));

    for (const entry of liveBusEntries) {
      const color = ROUTE_COLORS[entry.routeId] || "#fff";
      const dir = entry.direction ? ` ${entry.direction}` : "";
      output.push(
        `${getRouteName(entry.routeId)}${dir}: ${formatUnixTime(entry.arrivalUnix)} (${timeUntil(entry.arrivalUnix)})`
      );
    }

    document.getElementById("output").innerText = output.length
      ? output.join("\n")
      : `No trains for stop ${STOP_ID || "ALL"} route ${ROUTE_NAME || "ALL"}`;
  } catch (err) {
    console.error("Error fetching subway times:", err);
    document.getElementById("output").innerText = "Error fetching data: " + err.message;
  }
}
window.fetchSubwayTimes = fetchSubwayTimes;

async function renderMapIfNeeded() {
  if (!STOP_ID) return;

  const [lat, lon] = stopLatLng[STOP_ID] || [40.7128, -74.006];

  map = L.map("map").setView([lat, lon], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "Map data &copy; OpenStreetMap contributors"
  }).addTo(map);

  stopMarker = L.marker([lat, lon])
    .addTo(map)
    .bindPopup(`Stop ${STOP_ID}<br>${stopNameMap[STOP_ID] || "Unknown"}`);
}

// Extract a unix timestamp from a protobuf time field (handles Long objects)
function toUnix(timeField) {
  if (!timeField) return 0;
  const t = timeField.low !== undefined ? timeField.low : timeField;
  return typeof t === 'object' && t.toNumber ? t.toNumber() : Number(t) || 0;
}

// Interpolate a train's position between two stops based on current time
function interpolatePosition(prevStop, nextStop, now) {
  const prevCoord = stopLatLng[prevStop.stopId];
  const nextCoord = stopLatLng[nextStop.stopId];
  if (!prevCoord || !nextCoord) return null;

  const departTime = toUnix(prevStop.departure?.time) || toUnix(prevStop.arrival?.time);
  const arriveTime = toUnix(nextStop.arrival?.time) || toUnix(nextStop.departure?.time);

  if (!departTime || !arriveTime || arriveTime <= departTime) return null;

  // Clamp progress between 0 and 1
  let progress = (now - departTime) / (arriveTime - departTime);
  progress = Math.max(0, Math.min(1, progress));

  const lat = prevCoord[0] + (nextCoord[0] - prevCoord[0]) * progress;
  const lon = prevCoord[1] + (nextCoord[1] - prevCoord[1]) * progress;
  return [lat, lon];
}

// Find estimated positions for all active trains from TripUpdate data
function estimateTrainPositions(feeds) {
  const now = Date.now() / 1000;
  const trains = [];

  for (const message of feeds) {
    if (!message) continue;

    for (const entity of message.entity) {
      const tu = entity.tripUpdate;
      if (!tu || !tu.stopTimeUpdate || tu.stopTimeUpdate.length < 2) continue;

      const routeId = tu.trip?.routeId;
      if (ROUTE_NAME && routeId !== ROUTE_NAME.toUpperCase()) continue;

      const stops = tu.stopTimeUpdate;

      // Find the segment the train is currently on:
      // Look for consecutive stops where departure of prev <= now <= arrival of next
      let estimated = null;
      let prevStopName = "";
      let nextStopName = "";

      for (let i = 0; i < stops.length - 1; i++) {
        const prev = stops[i];
        const next = stops[i + 1];

        const prevDepart = toUnix(prev.departure?.time) || toUnix(prev.arrival?.time);
        const nextArrive = toUnix(next.arrival?.time) || toUnix(next.departure?.time);

        if (!prevDepart || !nextArrive) continue;

        // Train is between these two stops right now
        if (prevDepart <= now && now <= nextArrive) {
          estimated = interpolatePosition(prev, next, now);
          prevStopName = stopNameMap[prev.stopId] || prev.stopId;
          nextStopName = stopNameMap[next.stopId] || next.stopId;
          break;
        }
      }

      // If no current segment found, check if train is at/approaching first future stop
      if (!estimated) {
        const firstArrival = toUnix(stops[0].arrival?.time) || toUnix(stops[0].departure?.time);
        if (firstArrival && firstArrival > now && firstArrival - now < 120) {
          // Train is approaching the first listed stop (within 2 min)
          const coord = stopLatLng[stops[0].stopId];
          if (coord) {
            estimated = coord;
            nextStopName = stopNameMap[stops[0].stopId] || stops[0].stopId;
            prevStopName = "approaching";
          }
        }
      }

      if (!estimated) continue;

      const direction = stops[0].stopId?.endsWith("N") ? "Uptown" :
                        stops[0].stopId?.endsWith("S") ? "Downtown" : "";

      // Filter by direction parameter
      if (DIRECTION && direction.toLowerCase() !== DIRECTION.toLowerCase()) continue;

      trains.push({
        tripId: tu.trip.tripId,
        routeId: routeId,
        lat: estimated[0],
        lon: estimated[1],
        direction: direction,
        prevStop: prevStopName,
        nextStop: nextStopName
      });
    }
  }

  return trains;
}

// Cache last fetched feeds for smooth re-interpolation between API calls
let cachedFeeds = null;

function reinterpolatePositions() {
  if (!cachedFeeds || !map || !window.L) return;
  renderTrainsFromFeeds(cachedFeeds);
}

function renderTrainsFromFeeds(feeds) {
  if (window.vehicleLayerGroup) {
    window.vehicleLayerGroup.clearLayers();
  } else {
    window.vehicleLayerGroup = L.layerGroup().addTo(map);
  }

  const stopLat = stopLatLng[STOP_ID]?.[0];
  const stopLon = stopLatLng[STOP_ID]?.[1];
  const trains = estimateTrainPositions(feeds);

  for (const train of trains) {
    if (stopLat && stopLon) {
      const dist = getDistanceFromLatLonInKm(train.lat, train.lon, stopLat, stopLon);
      if (dist > 2) continue;
    }

    const color = ROUTE_COLORS[train.routeId] || "#808183";
    const dir = train.direction ? ` (${train.direction})` : "";
    const routeName = getRouteName(train.routeId);

    const marker = L.circleMarker([train.lat, train.lon], {
      radius: 8,
      fillColor: color,
      color: "#fff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).bindPopup(
      `<b>${routeName} Train</b>${dir}<br>` +
      `${train.prevStop} → ${train.nextStop}`
    );

    marker.addTo(window.vehicleLayerGroup);
  }
}

async function fetchAndRenderPositions() {
  if (!map || !window.L) return;

  const feedUrls = getFeedUrlsToQuery();

  try {
    const feeds = await Promise.all(feedUrls.map(url => fetchFeed(url).catch(() => null)));
    cachedFeeds = feeds;
    renderTrainsFromFeeds(feeds);
  } catch (err) {
    console.warn("Error estimating train positions:", err);
  }
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
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
  await fetchSubwayTimes();
  if (STOP_ID) {
    await renderMapIfNeeded();
    await fetchAndRenderPositions();
  } else {
    document.getElementById("map").classList.add("hidden");
  }
  updatePageTitle(ROUTE_NAME, stopNameMap[STOP_ID]);

  setInterval(fetchSubwayTimes, 60000);
  // Re-fetch feeds every 60s, but re-render interpolated positions every 10s for smooth tracking
  setInterval(fetchAndRenderPositions, 60000);
  setInterval(reinterpolatePositions, 10000);
})();
