const PROTO_FILE = "transit.proto";
const STOP_ID = "63";
const FEED_URL = "https://translink-proxy.onrender.com/gtfs"; // Replace with your actual URL

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("stop-title").innerText = `Next Buses for Stop ${STOP_ID}`;
});

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

    for (const stu of tripUpdate.stopTimeUpdate) {
      if (stu.stopId === STOP_ID) {
        const arrival = formatUnixTime(stu.arrival?.time);
        const departure = formatUnixTime(stu.departure?.time);
        output.push(
          `Trip ID: ${tripUpdate.trip.tripId}\nArrival: ${arrival}\nDeparture: ${departure}\n`
        );
      }
    }
  }

  document.getElementById("output").innerText = output.length
    ? output.join("\n")
    : "No upcoming buses for stop " + STOP_ID;
}

fetchBusTimes();
setInterval(fetchBusTimes, 60000); // refresh every 60s
