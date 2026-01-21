// BigWay Line Dashboard
// Expected record format:
// { id, timeAdded, lineSize, partySize, createdAt, updatedAt }
//
// How to use:
// - Host these files.
// - Provide your n8n webhook/data URL via query param:
//   index.html?data=https://YOUR_N8N_WEBHOOK_OR_STATIC_JSON_URL
//
// Notes:
// - Tolerates common n8n output shapes (array of records, array of {json:...}, {data:[...]}, etc.)
// - Graphs the last 24 hours based on timeAdded.

const DEFAULT_REFRESH_MS = 60_000; // 1 minute

let chartLine = null;
let chartParty = null;

function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function logStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
  console.log(msg);
}

function parseMaybeDate(x) {
  if (!x) return null;

  // Accept ISO strings, unix seconds, unix ms.
  if (typeof x === "number") {
    return new Date(x < 2e12 ? x * 1000 : x);
  }
  const s = String(x).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return new Date(n < 2e12 ? n * 1000 : n);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeN8nPayload(payload) {
  if (Array.isArray(payload)) {
    // n8n items: [{json:{...}}, ...]
    if (payload.length && payload[0] && typeof payload[0] === "object" && "json" in payload[0]) {
      return payload.map(it => it.json).filter(Boolean);
    }
    // plain array of records
    return payload.filter(Boolean);
  }

  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) return payload.data.filter(Boolean);
    if (Array.isArray(payload.items)) return payload.items.filter(Boolean);
    return [payload]; // single record
  }

  return [];
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function sanitizeRecords(rawRecords) {
  const out = [];
  for (const r of rawRecords) {
    if (!r || typeof r !== "object") continue;
    const t = parseMaybeDate(r.timeAdded);
    const lineSize = toNumber(r.lineSize);
    const partySize = toNumber(r.partySize);

    if (!t || lineSize === null || partySize === null) continue;

    out.push({
      id: r.id ?? null,
      timeAdded: t,
      lineSize,
      partySize,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    });
  }

  out.sort((a, b) => a.timeAdded - b.timeAdded);
  return out;
}

function filterLast24h(records) {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  return records.filter(r => {
    const ts = r.timeAdded.getTime();
    return ts >= cutoff && ts <= now;
  });
}

function setKpis(latest) {
  const elLine = document.getElementById("kpi-line");
  const elPeople = document.getElementById("kpi-people");
  const elAvg = document.getElementById("kpi-avg");
  const elTime = document.getElementById("kpi-time");

  if (!latest) {
    elLine.textContent = "—";
    elPeople.textContent = "—";
    elAvg.textContent = "—";
    elTime.textContent = "—";
    return;
  }

  elLine.textContent = String(latest.lineSize);
  elPeople.textContent = String(latest.partySize);

  const avg = latest.lineSize > 0 ? (latest.partySize / latest.lineSize) : null;
  elAvg.textContent = avg === null ? "—" : avg.toFixed(2);

  elTime.textContent = latest.timeAdded.toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  });
}

function makeLineChart(canvasId, points) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        data: points, // [{x: Date, y: number}]
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const d = items?.[0]?.raw?.x;
              return d ? new Date(d).toLocaleString() : "";
            }
          }
        }
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "hour", displayFormats: { hour: "HH:mm" } },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.06)" }
        }
      }
    }
  });
}

function upsertChart(existing, canvasId, points) {
  if (existing) {
    existing.data.datasets[0].data = points;
    existing.update();
    return existing;
  }
  return makeLineChart(canvasId, points);
}

async function fetchData(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  return await res.json();
}

async function refreshOnce() {
  const dataUrl = getParam("data");
  const refreshMs = Number(getParam("refresh") || DEFAULT_REFRESH_MS);

  document.getElementById("data-url").textContent = dataUrl ? dataUrl : "(no data URL set)";
  document.getElementById("refresh-interval").textContent = `${Math.round(refreshMs / 1000)}s`;

  if (!dataUrl) {
    logStatus("No data URL set. Add ?data=YOUR_N8N_URL to the page URL.");
    setKpis(null);
    return;
  }

  logStatus("Fetching data…");

  const payload = await fetchData(dataUrl);
  const raw = normalizeN8nPayload(payload);
  const records = sanitizeRecords(raw);
  const last24 = filterLast24h(records);

  if (!last24.length) {
    logStatus("No usable records in the last 24 hours (check payload + timeAdded).");
    setKpis(null);
    if (chartLine) { chartLine.destroy(); chartLine = null; }
    if (chartParty) { chartParty.destroy(); chartParty = null; }
    return;
  }

  const latest = last24[last24.length - 1];
  setKpis(latest);

  const linePoints = last24.map(r => ({ x: r.timeAdded, y: r.lineSize }));
  const partyPoints = last24.map(r => ({ x: r.timeAdded, y: r.partySize }));

  chartLine = upsertChart(chartLine, "chartLineSize", linePoints);
  chartParty = upsertChart(chartParty, "chartPartySize", partyPoints);

  logStatus(
    `OK: ${last24.length} points in last 24h\n` +
    `Latest: lineSize=${latest.lineSize}, partySize=${latest.partySize}, timeAdded=${latest.timeAdded.toISOString()}`
  );
}

function start() {
  const btn = document.getElementById("reload-btn");
  if (btn) btn.addEventListener("click", () => refreshOnce().catch(e => logStatus(String(e))));

  const refreshMs = Number(getParam("refresh") || DEFAULT_REFRESH_MS);
  refreshOnce().catch(e => logStatus(String(e)));
  setInterval(() => refreshOnce().catch(e => logStatus(String(e))), refreshMs);
}

document.addEventListener("DOMContentLoaded", start);
