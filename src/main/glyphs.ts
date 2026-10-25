import { crc32, deflateSync } from "node:zlib";

// Small white player icons, drawn in code: the taskbar buttons use them, so
// there are no image files to keep in step with the design.

export type Glyph = "previous" | "play" | "pause" | "next";
type Point = [number, number];

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  [x1, y1],
  [x2, y1],
  [x2, y2],
  [x1, y2],
];

// on a 16 × 16 grid, the size Windows shows them at on a normal screen
const SHAPES: Record<Glyph, Point[][]> = {
  play: [
    [
      [4.5, 2.5],
      [13.5, 8],
      [4.5, 13.5],
    ],
  ],
  pause: [rect(3.5, 2.5, 6.5, 13.5), rect(9.5, 2.5, 12.5, 13.5)],
  next: [
    [
      [2.5, 3],
      [10.5, 8],
      [2.5, 13],
    ],
    rect(11, 3, 13.5, 13),
  ],
  previous: [
    rect(2.5, 3, 5, 13),
    [
      [13.5, 3],
      [13.5, 13],
      [5.5, 8],
    ],
  ],
};

/** whether a point is inside a convex shape, whichever way round its corners go */
function inside(shape: Point[], x: number, y: number): boolean {
  let side = 0;
  for (let i = 0; i < shape.length; i++) {
    const [ax, ay] = shape[i];
    const [bx, by] = shape[(i + 1) % shape.length];
    const cross = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (cross === 0) continue;
    if (side && cross !== side) return false;
    side = cross;
  }
  return true;
}

const SAMPLES = 4;

/** RGBA pixels of a white glyph; each pixel is sampled 4 × 4 times so the edges come out smooth */
export function drawGlyph(glyph: Glyph, size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 16 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          if (SHAPES[glyph].some((shape) => inside(shape, x, y))) hits++;
        }
      }
      const i = (py * size + px) * 4;
      pixels.fill(255, i, i + 3);
      pixels[i + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** a square RGBA picture as a PNG file */
export function encodePng(rgba: Buffer, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  // every row starts with a byte saying it isn't filtered
  const stride = size * 4;
  const rows = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
