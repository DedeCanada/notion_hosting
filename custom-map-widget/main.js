fetch('data.json')
  .then(res => res.json())
  .then(initMap);

function initMap(data) {
  const allCoords = [];

  // Collect coordinates for centering
  data.points.forEach(p => allCoords.push([p.lat, p.lng]));
  data.paths.forEach(path => path.points.forEach(p => allCoords.push([p.lat, p.lng])));
  const center = averageCoordinates(allCoords);

  const map = L.map('map').setView(center, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Add custom markers
  data.points.forEach(point => {
    const iconUrl = `icons/${point.icon}`;
    const marker = createColoredMarker(point.lat, point.lng, point.color, iconUrl, point.label);
    marker.addTo(map);
  });

  // Add labeled paths
  data.paths.forEach(path => {
    const latlngs = path.points.map(p => [p.lat, p.lng]);
    const polyline = L.polyline(latlngs, { color: path.color || 'black' }).addTo(map);

    if (path.label && latlngs.length > 0) {
      let midLatLng;
      const midIndex = Math.floor(latlngs.length / 2);

      if (latlngs.length % 2 === 0) {
        const p1 = latlngs[midIndex - 1];
        const p2 = latlngs[midIndex];
        midLatLng = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      } else {
        midLatLng = latlngs[midIndex];
      }

    const defaultSizePx = 14;
    const userSize = parseFloat(path.size || defaultSizePx);
    const scale = userSize / defaultSizePx;

    const styleId = `dynamic-tooltip-style-${userSize}`;
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;

      style.textContent = `
        .tooltip-${userSize} {
          position: absolute;
          transform: translate(-50%, -50%);
          background: rgba(255, 255, 255, 0.9);
          padding: ${2 * scale}px ${6 * scale}px;
          border-radius: ${4 * scale}px;
          font-size: ${userSize}px;
          font-family: sans-serif;
          pointer-events: none;
          white-space: nowrap;
          border: ${1 * scale}px solid #ccc;
        }
      `;
      document.head.appendChild(style);
    }

    L.tooltip({
      permanent: true,
      direction: 'center',
      className: `path-label tooltip-${userSize}`
    })
      .setContent(path.label)
      .setLatLng(midLatLng)
      .addTo(map);
    }
  });

  // Only show lat/lng if checkbox is checked
  map.on('click', function (e) {
    const showCoords = document.getElementById('toggle-latlng')?.checked;
    if (!showCoords) return;

    const content = `"lat": ${e.latlng.lat.toFixed(5)}, "lng": ${e.latlng.lng.toFixed(5)},`;
    L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
  });
}

function createColoredMarker(lat, lng, color, iconPath, label) {
  const iconHTML = `
    <div style="
      background-color: ${color};
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #fff;
      box-shadow: 0 0 3px rgba(0,0,0,0.6);
    ">
      <img src="${iconPath}" style="width: 20px; height: 20px; filter: brightness(0) saturate(100%) invert(1);" />
    </div>
  `;

  const customIcon = L.divIcon({
    html: iconHTML,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });

  return L.marker([lat, lng], { icon: customIcon }).bindPopup(label);
}

function averageCoordinates(coords) {
  const [sumLat, sumLng] = coords.reduce(
    ([lat, lng], [clat, clng]) => [lat + clat, lng + clng],
    [0, 0]
  );
  return [sumLat / coords.length, sumLng / coords.length];
}
