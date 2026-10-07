const fs = require('node:fs');
const path = require('node:path');

const width = 256;
const height = 256;
const xorSize = width * height * 4;
const maskStride = Math.ceil(width / 32) * 4;
const maskSize = maskStride * height;
const dibSize = 40 + xorSize + maskSize;
const buffer = Buffer.alloc(6 + 16 + dibSize);
let o = 0;

buffer.writeUInt16LE(0, o); o += 2;
buffer.writeUInt16LE(1, o); o += 2;
buffer.writeUInt16LE(1, o); o += 2;

buffer.writeUInt8(0, o++);
buffer.writeUInt8(0, o++);
buffer.writeUInt8(0, o++);
buffer.writeUInt8(0, o++);
buffer.writeUInt16LE(1, o); o += 2;
buffer.writeUInt16LE(32, o); o += 2;
buffer.writeUInt32LE(dibSize, o); o += 4;
buffer.writeUInt32LE(22, o); o += 4;

buffer.writeUInt32LE(40, o); o += 4;
buffer.writeInt32LE(width, o); o += 4;
buffer.writeInt32LE(height * 2, o); o += 4;
buffer.writeUInt16LE(1, o); o += 2;
buffer.writeUInt16LE(32, o); o += 2;
buffer.writeUInt32LE(0, o); o += 4;
buffer.writeUInt32LE(xorSize, o); o += 4;
buffer.writeInt32LE(0, o); o += 4;
buffer.writeInt32LE(0, o); o += 4;
buffer.writeUInt32LE(0, o); o += 4;
buffer.writeUInt32LE(0, o); o += 4;

const pixelOffset = o;
const setPixel = (x, y, r, g, b, a = 255) => {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const row = height - 1 - y;
  const p = pixelOffset + (row * width + x) * 4;
  buffer[p] = b;
  buffer[p + 1] = g;
  buffer[p + 2] = r;
  buffer[p + 3] = a;
};

const roundedInside = (x, y, left, top, right, bottom, radius) => {
  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true;
  if (y >= top + radius && y <= bottom - radius && x >= left && x <= right) return true;
  const cx = x < left + radius ? left + radius : right - radius;
  const cy = y < top + radius ? top + radius : bottom - radius;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (!roundedInside(x, y, 12, 12, 243, 243, 42)) continue;
    const t = (x + y) / (width + height);
    setPixel(x, y, Math.round(28 + 18 * t), Math.round(36 + 28 * t), Math.round(55 + 45 * t));
  }
}

for (let y = 58; y <= 190; y++) {
  for (let x = 42; x <= 214; x++) {
    const border = x < 50 || x > 206 || y < 66 || y > 182;
    if (border) setPixel(x, y, 225, 231, 239);
  }
}

for (let y = 91; y <= 157; y++) {
  const half = Math.floor((y - 91) * 0.52);
  for (let x = 101; x <= 101 + half; x++) {
    setPixel(x, y, 248, 250, 252);
  }
}
for (let y = 158; y <= 190; y++) {
  const half = Math.floor((190 - y) * 1.04);
  for (let x = 101; x <= 101 + half; x++) {
    setPixel(x, y, 248, 250, 252);
  }
}

for (let y = 38; y <= 82; y++) {
  for (let x = 28; x <= 38; x++) setPixel(x, y, 239, 68, 68);
  for (let x = 218; x <= 228; x++) setPixel(x, y, 239, 68, 68);
}
for (let x = 28; x <= 62; x++) {
  for (let y = 38; y <= 48; y++) setPixel(x, y, 239, 68, 68);
}
for (let x = 204; x <= 228; x++) {
  for (let y = 38; y <= 48; y++) setPixel(x, y, 239, 68, 68);
}

const out = path.join(__dirname, '..', 'build', 'icon.ico');
fs.writeFileSync(out, buffer);
console.log(out);
