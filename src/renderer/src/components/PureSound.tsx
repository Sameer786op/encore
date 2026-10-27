import { AudioWaveform } from "lucide-react";
import { useSettings } from "@/settings/store";
import { cn } from "@/lib/cn";

/** says that a sound setting is waiting while Pure sound is on, with a way to turn Pure sound off */
export function PausedForPureSound({ what, compact, className }: { what: string; compact?: boolean; className?: string }) {
  const update = useSettings((s) => s.update);
  return (
    <div
      role="status"
      className={cn("flex items-center gap-2.5 rounded-[14px] bg-accent/10 text-ink-2", compact ? "px-3 py-2 text-[11.5px]" : "px-4 py-2.5 text-[12.5px]", className)}
    >
      <AudioWaveform className={cn("shrink-0 text-accent", compact ? "size-3.5" : "size-4")} />
      <span className="min-w-0 flex-1 leading-snug">{what} waits while Pure sound is on.</span>
      <button onClick={() => update({ pureSound: false })} className="pressable shrink-0 rounded-full px-2 py-0.5 font-semibold text-accent hover:bg-accent/10">
        Turn off
      </button>
    </div>
  );
}
