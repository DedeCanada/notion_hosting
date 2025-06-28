const PROTO_FILE = "transit.proto";
const STOP_ID = "10863";
const FEED_URL = "https://translink-proxy.onrender.com/gtfs"; // Replace with your actual URL

async function fetchBusTimes() {
  const response = await fetch(FEED_URL);
  // const buffer = await response.arrayBuffer();
  const text = await response.text();
  console.log(text);


  const root = await protobuf.load(PROTO_FILE);
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

  const message = FeedMessage.decode(new Uint8Array(buffer));
  const output = [];

  for (const entity of message.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;

    for (const stu of tripUpdate.stopTimeUpdate) {
      if (stu.stopId === STOP_ID) {
        const arrival = stu.arrival?.time ?? "Unknown";
        const departure = stu.departure?.time ?? "Unknown";
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
