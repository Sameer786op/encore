import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * The Vyse Music mark: two glossy shards making a V, and a lime spark. Its
 * colours follow the accent (styles.css --logo-1..3, set by ui/appearance.ts).
 * The window and tray keep the app icon picture (assets/logo.png).
 */
export function Logo({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-1)" />
          <stop offset="0.5" stopColor="var(--logo-2)" />
          <stop offset="1" stopColor="var(--logo-3)" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e4ff8a" />
          <stop offset="1" stopColor="var(--ramp-3)" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="0.3" cy="0.2" r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M10 14 L26 14 L34 40 L28 54 Z" fill={`url(#${id}a)`} stroke={`url(#${id}a)`} strokeWidth="7" strokeLinejoin="round" />
      <path d="M38 14 L54 14 L40 46 Z" fill={`url(#${id}a)`} stroke={`url(#${id}a)`} strokeWidth="7" strokeLinejoin="round" opacity="0.85" />
      <path d="M10 14 L26 14 L34 40 L28 54 Z" fill={`url(#${id}h)`} />
      <circle cx="47" cy="50" r="6" fill={`url(#${id}s)`} />
    </svg>
  );
}
