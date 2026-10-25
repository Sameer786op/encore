import { cn } from "@/lib/cn";

/** three bouncing bars marking the song that is playing */
export function PlayingBars({ paused, className }: { paused?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-3.5 items-end gap-[2px]", paused && "eq-paused", className)} aria-label={paused ? "Paused" : "Playing"}>
      {[0, 0.3, 0.15].map((delay, i) => (
        <span key={i} className="eq-bar h-full w-[3px] rounded-full bg-accent" style={{ animationDelay: `-${delay}s` }} />
      ))}
    </span>
  );
}
