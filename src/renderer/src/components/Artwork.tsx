import { useState, type ReactNode } from "react";
import { Music } from "lucide-react";
import { cn } from "@/lib/cn";

interface ArtworkProps {
  src?: string;
  alt?: string;
  className?: string;
  /** shown when there is no image */
  fallback?: ReactNode;
}

export function Artwork({ src, alt = "", className, fallback }: ArtworkProps) {
  // remember which URL finished, so a cached image that loads instantly still shows
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();
  const loaded = !!src && loadedSrc === src;
  const failed = !!src && failedSrc === src;

  return (
    // a soft shimmer while the cover is on its way, then it settles in
    <div className={cn("relative shrink-0 overflow-hidden bg-surface-3", src && !loaded && !failed && "skeleton", className)}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && loadedSrc !== src) setLoadedSrc(src);
          }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn(
            "size-full object-cover transition-[opacity,scale] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
            loaded ? "scale-100 opacity-100" : "scale-[1.04] opacity-0",
          )}
        />
      ) : (
        <div className="grid size-full place-items-center bg-gradient-to-br from-surface-3 to-surface-2 text-ink-3">
          {fallback ?? <Music className="size-2/5" strokeWidth={1.5} />}
        </div>
      )}
    </div>
  );
}

/** a 2x2 grid of covers for playlists, or one cover when there are fewer than four */
export function Mosaic({ sources, className, fallback }: { sources: (string | undefined)[]; className?: string; fallback?: ReactNode }) {
  const unique = [...new Set(sources.filter((s): s is string => !!s))];
  if (unique.length < 4) return <Artwork src={unique[0]} className={className} fallback={fallback} />;
  return (
    <div className={cn("grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden bg-surface-3", className)}>
      {unique.slice(0, 4).map((src) => (
        <Artwork key={src} src={src} className="size-full" />
      ))}
    </div>
  );
}
