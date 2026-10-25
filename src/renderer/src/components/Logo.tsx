import { useId } from "react";

/** the Encore mark in the accent colour; the same drawing as the app icon (resources/icon.svg) */
export function Logo({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg aria-hidden viewBox="16 16 480 480" className={className}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--logo-1, #ff6b81)", transition: "stop-color 0.5s" }} />
          <stop offset="0.55" style={{ stopColor: "var(--logo-2, #fa2d48)", transition: "stop-color 0.5s" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-3, #c2163a)", transition: "stop-color 0.5s" }} />
        </linearGradient>
        <radialGradient id={`${id}shine`} cx="0.3" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#${id}bg)`} />
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#${id}shine)`} />
      <g stroke="#ffffff" strokeWidth="38" strokeLinecap="round">
        <line x1="136" y1="222" x2="136" y2="290" />
        <line x1="196" y1="160" x2="196" y2="352" />
        <line x1="256" y1="200" x2="256" y2="312" />
        <line x1="316" y1="130" x2="316" y2="382" />
        <line x1="376" y1="190" x2="376" y2="322" />
      </g>
    </svg>
  );
}
