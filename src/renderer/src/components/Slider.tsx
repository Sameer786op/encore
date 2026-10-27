import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

interface SliderProps {
  value: number;
  max: number;
  label: string;
  /** called continuously while dragging */
  onChange?: (value: number) => void;
  /** called once when the drag ends or a key is pressed */
  onCommit?: (value: number) => void;
  step?: number;
  formatValue?: (value: number) => string;
  className?: string;
  /** a hairline bar, for tight spots like the player */
  thin?: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface ScrubOptions {
  value: number;
  max: number;
  label: string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  step?: number;
  formatValue?: (value: number) => string;
}

/**
 * Dragging, hovering and arrow keys for anything you scrub along: the slider
 * below and the player's waveform seek bar. Spread `props` on the element.
 */
export function useScrub({ value, max, label, onChange, onCommit, step = 1, formatValue }: ScrubOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const fromPointer = (event: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width, 0, 1) * max;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || max <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const v = fromPointer(event);
    setDragValue(v);
    onChange?.(v);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (max <= 0) return;
    const v = fromPointer(event);
    setHoverValue(v);
    if (dragValue !== null) {
      setDragValue(v);
      onChange?.(v);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragValue === null) return;
    const v = fromPointer(event);
    setDragValue(null);
    onCommit?.(v);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
    let next: number | null = null;
    if (event.key in moves) next = clamp(value + moves[event.key], 0, max);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onChange?.(next);
    onCommit?.(next);
  };

  const shown = dragValue ?? value;
  const tip = dragValue ?? hoverValue ?? 0;
  return {
    /** 0 to 100, where the value sits */
    percent: max > 0 ? clamp(shown / max, 0, 1) * 100 : 0,
    /** being dragged */
    active: dragValue !== null,
    /** being dragged or hovered */
    engaged: dragValue !== null || hoverValue !== null,
    /** the value under the pointer, for a tooltip */
    tip,
    tipPercent: max > 0 ? clamp(tip / max, 0, 1) * 100 : 0,
    props: {
      ref,
      role: "slider",
      tabIndex: 0,
      "aria-label": label,
      "aria-valuemin": 0,
      "aria-valuemax": max,
      "aria-valuenow": Math.round(shown),
      "aria-valuetext": formatValue?.(shown),
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => setDragValue(null),
      onPointerLeave: () => setHoverValue(null),
      onKeyDown,
    } as const,
  };
}

export function Slider({ value, max, label, onChange, onCommit, step = 1, formatValue, className, thin }: SliderProps) {
  const { percent, engaged, tip, tipPercent, props } = useScrub({ value, max, label, onChange, onCommit, step, formatValue });

  // Apple style: no knob. The bar swells while you hover or drag it, and the
  // part you've passed stays white.
  return (
    <div
      {...props}
      className={cn("group relative flex h-4 cursor-pointer touch-none items-center", className)}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-white/[0.16] transition-[height,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          thin ? (engaged ? "h-[6px]" : "h-[3px]") : engaged ? "h-[8px]" : "h-[4px]",
          engaged && "bg-white/[0.22]",
        )}
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-colors duration-300", engaged ? "bg-white" : "bg-white/80")}
          style={{ width: `${percent}%` }}
        />
      </div>
      {formatValue && engaged && (
        <div
          className="glass-menu pointer-events-none absolute -top-8 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
          style={{ left: `${tipPercent}%` }}
        >
          {formatValue(tip)}
        </div>
      )}
    </div>
  );
}
