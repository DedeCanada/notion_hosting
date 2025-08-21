const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'data.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Build a lookup for points by lat/lng
const pointMap = {};
data.points.forEach(pt => {
  const key = `${pt.lat},${pt.lng}`;
  pointMap[key] = pt.label;
});

// Update each path point
data.paths.forEach(pathObj => {
  pathObj.points.forEach(pt => {
    const key = `${pt.lat},${pt.lng}`;
    if (pointMap[key]) {
      pt.name = pointMap[key];
    }
  });
});

// Write back to file
fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log('data.json updated!');