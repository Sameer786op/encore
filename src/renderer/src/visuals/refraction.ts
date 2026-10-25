// Displacement maps for Liquid Glass. Near the edge of a rounded pane, the
// picture behind is bent inward, the way light bends through the curved rim
// of a thick piece of glass. The map stores that bend per pixel: red is the
// sideways shift, green the up/down shift, 128 meaning none.

const cache = new Map<string, string>();
const MAX_CACHE = 24;

/** signed distance to a rounded rectangle's edge (negative inside) and the outward direction there */
function edge(px: number, py: number, hw: number, hh: number, r: number): { d: number; nx: number; ny: number } {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  const qx = ax - (hw - r);
  const qy = ay - (hh - r);
  const sx = Math.sign(px) || 1;
  const sy = Math.sign(py) || 1;
  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy) || 1;
    return { d: len - r, nx: (qx / len) * sx, ny: (qy / len) * sy };
  }
  if (qx > qy) return { d: qx - r, nx: sx, ny: 0 };
  return { d: qy - r, nx: 0, ny: sy };
}

/**
 * A map for a pane of this size. `bezel` is how far in from the edge the
 * glass curves; the bend is strongest right at the rim and fades to nothing.
 * Maps are drawn at half size: the bend is smooth, so nobody can tell.
 */
export function refractionMap(width: number, height: number, radius: number, bezel: number): string {
  const w = Math.max(2, Math.round(width / 2));
  const h = Math.max(2, Math.round(height / 2));
  const r = Math.min(radius, width / 2, height / 2) / 2;
  const b = Math.max(1, bezel / 2);
  const key = `${w}x${h}:${r}:${b}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(w, h);
  const data = image.data;
  const hw = w / 2;
  const hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { d, nx, ny } = edge(x + 0.5 - hw, y + 0.5 - hh, hw, hh, r);
      const inside = -d;
      let dx = 0;
      let dy = 0;
      if (inside < b) {
        const t = Math.max(0, inside) / b;
        // a convex rim: steep at the edge, flattening out toward the middle
        const bend = (1 - t) * (1 - t);
        // look inward, so the edge shows a stretched view of what is under the glass
        dx = -nx * bend;
        dy = -ny * bend;
      }
      const i = (y * w + x) * 4;
      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL("image/png");
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return url;
}
