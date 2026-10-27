import { PictureInPicture2 } from "lucide-react";
import { globalKeysFor } from "@shared/shortcuts";
import type { MiniConfig, MiniCorner } from "@shared/types";
import { Toggle } from "@/components/common";
import { cn } from "@/lib/cn";
import { useSettings } from "@/settings/store";
import { useGlobalKeyStates } from "@/ui/shortcuts";
import { Card, Row } from "./parts";
import { GLOBAL_SHORTCUTS_ID, Keys } from "./ShortcutSettings";

// Settings → Mini player: when it opens, whether it floats above other
// windows, which corner it opens in, and the keys that show it from anywhere.

const CORNERS: { value: Exclude<MiniCorner, "remember">; label: string; place: string }[] = [
  { value: "top-left", label: "Top left", place: "left-[7px] top-[7px]" },
  { value: "top-right", label: "Top right", place: "right-[7px] top-[7px]" },
  { value: "bottom-left", label: "Bottom left", place: "bottom-[7px] left-[7px]" },
  { value: "bottom-right", label: "Bottom right", place: "bottom-[7px] right-[7px]" },
];

/** a little screen with the mini player in each corner, and "where I leave it" beside it */
function CornerPicker({ value, onChange }: { value: MiniCorner; onChange: (corner: MiniCorner) => void }) {
  return (
    <div role="radiogroup" aria-label="Where the mini player opens" className="flex items-center gap-3">
      <button
        role="radio"
        aria-checked={value === "remember"}
        onClick={() => onChange("remember")}
        className={cn(
          "pressable rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
          value === "remember" ? "bg-accent/15 text-accent-ink ring-1 ring-accent/50" : "bg-white/[0.06] text-ink-2 hover:text-ink",
        )}
      >
        Where I leave it
      </button>
      <div className="relative h-[62px] w-[100px] rounded-[10px] border border-white/[0.12] bg-white/[0.04]">
        {CORNERS.map((corner) => (
          <button
            key={corner.value}
            role="radio"
            aria-checked={value === corner.value}
            aria-label={corner.label}
            title={corner.label}
            onClick={() => onChange(corner.value)}
            className={cn(
              "absolute h-[13px] w-[30px] rounded-[4px] transition-[background-color,box-shadow] duration-200",
              corner.place,
              value === corner.value ? "bg-accent shadow-[0_2px_8px_rgb(var(--accent-rgb)/0.45)]" : "bg-white/[0.14] hover:bg-white/[0.28]",
            )}
          />
        ))}
      </div>
    </div>
  );
}

const CORNER_TEXT: Record<MiniCorner, string> = {
  remember: "It comes back wherever you last dragged it.",
  "top-left": "The top-left corner of your main screen, every time it opens.",
  "top-right": "The top-right corner of your main screen, every time it opens.",
  "bottom-left": "The bottom-left corner of your main screen, every time it opens.",
  "bottom-right": "The bottom-right corner of your main screen, every time it opens.",
};

export function MiniPlayerSettings() {
  const mini = useSettings((s) => s.miniPlayer);
  const globalKeys = useSettings((s) => s.globalKeys);
  const update = useSettings((s) => s.update);
  const keyState = useGlobalKeyStates((s) => s.states.mini);
  const set = (patch: Partial<MiniConfig>) => update({ miniPlayer: { ...mini, ...patch } });
  const combo = globalKeys.enabled ? globalKeysFor(globalKeys).mini : "";

  return (
    <Card>
      <Row title="Open the mini player when Vyse Music is minimized" body="A small player you can drag anywhere.">
        <Toggle checked={mini.showOnMinimize} onChange={(showOnMinimize) => set({ showOnMinimize })} label="Mini player on minimize" />
      </Row>
      <Row title="Keep it above other windows" body={mini.alwaysOnTop ? "It floats over everything, even full-screen apps." : "Other windows can cover it, like any other window."}>
        <Toggle checked={mini.alwaysOnTop} onChange={(alwaysOnTop) => set({ alwaysOnTop })} label="Keep the mini player above other windows" />
      </Row>
      <Row title="Where it opens" body={CORNER_TEXT[mini.corner]}>
        <CornerPicker value={mini.corner} onChange={(corner) => set({ corner })} />
      </Row>
      <Row
        title="Show or hide it from anywhere"
        body={
          !combo
            ? "Turned off. You can set keys for it under Shortcuts anywhere in Windows."
            : keyState === "taken"
              ? "Another app is using these keys. Pick different ones under Shortcuts anywhere in Windows."
              : "Works even while you're in another app."
        }
      >
        <button
          onClick={() => document.getElementById(GLOBAL_SHORTCUTS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          aria-label="Change the keys that show the mini player"
          title="Change"
          className="pressable inline-flex min-h-[30px] items-center rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.06]"
        >
          {combo ? <Keys combo={combo} /> : <span className="text-[12.5px] text-ink-3">Off</span>}
        </button>
      </Row>
      <Row title="Open it now">
        <button onClick={() => void window.encore.mini.open()} className="glass-control pressable inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125">
          <PictureInPicture2 className="size-4" /> Mini player
        </button>
      </Row>
    </Card>
  );
}
