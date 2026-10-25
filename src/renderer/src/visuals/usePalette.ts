import { useEffect, useState } from "react";
import { MEDIA_SCHEME } from "@shared/types";
import { extractPalette, FALLBACK_PALETTE, forBackground, type RGB } from "./palette";

const cache = new Map<string, RGB[]>();

/** cover art the canvas may read: local art directly, web art through our proxy */
function readableUrl(src: string): string {
  if (src.startsWith(`${MEDIA_SCHEME}:`)) return src;
  return `${MEDIA_SCHEME}://image/?u=${encodeURIComponent(src)}`;
}

function load(src: string): Promise<RGB[]> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 32, 32);
        const palette = forBackground(extractPalette(ctx.getImageData(0, 0, 32, 32).data, 4));
        cache.set(src, palette);
        if (cache.size > 100) cache.delete(cache.keys().next().value!);
        resolve(palette);
      } catch {
        resolve(forBackground(FALLBACK_PALETTE));
      }
    };
    img.onerror = () => resolve(forBackground(FALLBACK_PALETTE));
    img.src = readableUrl(src);
  });
}

/** background colours taken from a cover */
export function usePalette(src: string | undefined): RGB[] {
  const [palette, setPalette] = useState<RGB[]>(() => (src && cache.get(src)) || forBackground(FALLBACK_PALETTE));
  useEffect(() => {
    if (!src) return setPalette(forBackground(FALLBACK_PALETTE));
    let alive = true;
    void load(src).then((p) => alive && setPalette(p));
    return () => {
      alive = false;
    };
  }, [src]);
  return palette;
}
