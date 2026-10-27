import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Covers for the collections that have no artwork of their own (Liked Songs,
// Local files): a dark plate lit by glows in the signature colours, with grain,
// the way the Ember backdrop is lit. They follow the accent, so another accent
// colour relights them.

const LIGHTS = {
  // ember rising from the lower left, amber overhead, a glint of lime
  liked:
    "radial-gradient(95% 85% at 14% 104%, var(--ramp-1), transparent 68%), radial-gradient(70% 62% at 92% 4%, color-mix(in srgb, var(--ramp-2) 78%, transparent), transparent 70%), radial-gradient(46% 40% at 96% 96%, color-mix(in srgb, var(--ramp-3) 60%, transparent), transparent 72%)",
  // lime from the lower right, a warm edge top left
  local:
    "radial-gradient(95% 85% at 88% 104%, var(--ramp-3), transparent 68%), radial-gradient(64% 58% at 6% 2%, color-mix(in srgb, var(--ramp-2) 70%, transparent), transparent 70%), radial-gradient(50% 44% at 0% 92%, color-mix(in srgb, var(--ramp-1) 55%, transparent), transparent 72%)",
} as const;

export function GlowCover({ tone, icon, className }: { tone: keyof typeof LIGHTS; icon: ReactNode; className?: string }) {
  return (
    <div className={cn("relative isolate grid shrink-0 place-items-center overflow-hidden bg-[#0d0806] text-snow", className)} style={{ backgroundImage: LIGHTS[tone] }}>
      {/* the cover stays dark in both modes, so its grain doesn't follow the mode's */}
      <span aria-hidden className="grain absolute inset-0" style={{ opacity: 0.4 }} />
      {/* light caught along the top edge */}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255/0.14),transparent_38%)]" />
      <span className="relative grid size-full place-items-center drop-shadow-[0_6px_18px_rgb(0_0_0/0.35)]">{icon}</span>
    </div>
  );
}
