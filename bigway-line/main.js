// BigWay Line Dashboard (FIXED)
// - One chart, two lines (lineSize + partySize)
// - X axis fixed to [now-24h, now]
// - Visible points (dots)
// - Supports payload formats including: [ { data: [...] } ]

const DEFAULT_REFRESH_MS = 60_000; // 1 minute
let combinedChart = null;

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
  if (typeof x === "number") return new Date(x < 2e12 ? x * 1000 : x);

  const s = String(x).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return new Date(n < 2e12 ? n * 1000 : n);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeN8nPayload(payload) {
  // Format: [ { data: [ ... ] } ]
  if (Array.isArray(payload) && payload.length === 1 && Array.isArray(payload[0]?.data)) {
    return payload[0].data;
  }

  // Array of { data: [...] }
  if (Array.isArray(payload) && payload.length && Array.isArray(payload[0]?.data)) {
    return payload.flatMap(x => (Array.isArray(x?.data) ? x.data : []));
  }

  // n8n items: [{ json: {...} }, ...]
  if (Array.isArray(payload) && payload.length && payload[0] && typeof payload[0] === "object" && "json" in payload[0]) {
    return payload.map(it => it.json).filter(Boolean);
  }

  // plain array of records
  if (Array.isArray(payload)) return payload.filter(Boolean);

  // object with data:[...]
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) return payload.data.filter(Boolean);

  // object with items:[...]
  if (payload && typeof payload === "object" && Array.isArray(payload.items)) return payload.items.filter(Boolean);

  // single record object
  if (payload && typeof payload === "object") return [payload];

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

function filterRange(records, xMin, xMax) {
  const minTs = xMin.getTime();
  const maxTs = xMax.getTime();
  return records.filter(r => {
    const ts = r.timeAdded.getTime();
    return ts >= minTs && ts <= maxTs;
  });
}

function setKpis(latest) {
  const elLine = document.getElementById("kpi-line");
  const elPeople = document.getElementById("kpi-people");
  const elAvg = document.getElementById("kpi-avg");
  const elTime = document.getElementById("kpi-time");

  if (!latest) {
    if (elLine) elLine.textContent = "—";
    if (elPeople) elPeople.textContent = "—";
    if (elAvg) elAvg.textContent = "—";
    if (elTime) elTime.textContent = "—";
    return;
  }

  if (elLine) elLine.textContent = String(latest.lineSize);
  if (elPeople) elPeople.textContent = String(latest.partySize);

  const avg = latest.lineSize > 0 ? (latest.partySize / latest.lineSize) : null;
  if (elAvg) elAvg.textContent = avg === null ? "—" : avg.toFixed(2);

  if (elTime) elTime.textContent = `Last reading: ${latest.timeAdded.toLocaleString()}`;
}

function makeCombinedChart(linePoints, partyPoints, xMin, xMax) {
  const canvas = document.getElementById("chartCombined");
  if (!canvas) return null;

  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Line Size (parties)",
          data: linePoints,
          tension: 0,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
        {
          label: "Party Size (people)",
          data: partyPoints,
          tension: 0,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      plugins: {
        legend: { display: true },
      },
      scales: {
        x: {
          type: "time",
          min: xMin,   // ✅ now defined
          max: xMax,
          time: { unit: "hour", displayFormats: { hour: "HH:mm" } },
          ticks: { maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
        },
      },
    },
  });
}

function upsertCombinedChart(linePoints, partyPoints, xMin, xMax) {
  if (!combinedChart) {
    combinedChart = makeCombinedChart(linePoints, partyPoints, xMin, xMax);
    return;
  }

  combinedChart.data.datasets[0].data = linePoints;
  combinedChart.data.datasets[1].data = partyPoints;

  combinedChart.options.scales.x.min = xMin;
  combinedChart.options.scales.x.max = xMax;

  combinedChart.update("none");
}


async function fetchData(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  return await res.json();
}

async function refreshOnce() {
  const dataUrl = getParam("data");
  const refreshMs = Number(getParam("refresh") || DEFAULT_REFRESH_MS);

  const elUrl = document.getElementById("data-url");
  const elInt = document.getElementById("refresh-interval");

  if (elUrl) elUrl.textContent = dataUrl ? dataUrl : "(no data URL set)";
  if (elInt) elInt.textContent = `${Math.round(refreshMs / 1000)}s`;

  if (!dataUrl) {
    logStatus("No data URL set. Add ?data=YOUR_N8N_URL to the page URL.");
    setKpis(null);
    return;
  }

  // Fixed time window: [now-24h, now]
  const xMax = new Date();
  const xMin = new Date(xMax.getTime() - 24 * 60 * 60 * 1000);

  logStatus("Fetching data…");

  const payload = await fetchData(dataUrl);
  const raw = normalizeN8nPayload(payload);
  const records = sanitizeRecords(raw);

  const last24 = filterRange(records, xMin, xMax);

  if (!last24.length) {
    setKpis(null);
    if (combinedChart) {
      combinedChart.destroy();
      combinedChart = null;
    }
    logStatus(
      "No usable records in the last 24 hours.\n" +
      `Window: ${xMin.toISOString()} → ${xMax.toISOString()}`
    );
    return;
  }

  const latest = last24[last24.length - 1];
  setKpis(latest);

  const linePoints = last24.map(r => ({ x: r.timeAdded, y: r.lineSize }));
  const partyPoints = last24.map(r => ({ x: r.timeAdded, y: r.partySize }));

  upsertCombinedChart(linePoints, partyPoints, xMin, xMax);

  logStatus(
    `OK: ${last24.length} points in last 24h\n` +
    `Window: ${xMin.toISOString()} → ${xMax.toISOString()}\n` +
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
