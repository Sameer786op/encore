import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMenu, type MenuEntry, type MenuItem } from "@/ui/menu";

const MARGIN = 8;

interface PanelProps {
  entries: MenuEntry[];
  x: number;
  y: number;
  /** place the panel's right edge at x (submenus that would overflow) */
  alignRight?: boolean;
  onDone: () => void;
}

function MenuPanel({ entries, x, y, alignRight, onDone }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number; alignRight: boolean } | null>(null);

  // keep the panel inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = alignRight ? x - width : x;
    if (left + width + MARGIN > window.innerWidth) left = x - width;
    left = Math.max(MARGIN, left);
    const top = y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, window.innerHeight - height - MARGIN) : y;
    setPos({ left, top });
  }, [x, y, alignRight]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)") ?? [])];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(at + step + list.length) % list.length]?.focus();
  };

  const openSub = (index: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const flip = rect.right + 240 > window.innerWidth;
    setSub({ index, x: flip ? rect.left - 4 : rect.right + 4, y: rect.top - 6, alignRight: flip });
  };

  const subEntries = sub ? (entries[sub.index] as MenuItem).submenu : undefined;

  return (
    <>
      <motion.div
        ref={ref}
        role="menu"
        initial={{ opacity: 0, scale: 0.9, filter: "blur(2px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12, ease: [0.32, 0.72, 0, 1] } }}
        transition={{ type: "spring", stiffness: 620, damping: 38, mass: 0.6, filter: { duration: 0.16, ease: "easeOut" } }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="glass-menu fixed z-50 max-h-[70vh] min-w-56 max-w-72 origin-top-left overflow-y-auto rounded-[20px] p-1.5 scrollbar-none"
      >
        {entries.map((entry, index) => {
          if (entry === "divider") return <div key={`divider-${index}`} className="mx-3 my-1 h-px bg-line" />;
          const Icon = entry.icon;
          return (
            <button
              key={`${entry.label}-${index}`}
              role="menuitem"
              disabled={entry.disabled}
              onPointerEnter={(e) => (entry.submenu ? openSub(index, e.currentTarget) : setSub(null))}
              onKeyDown={(e) => {
                if (entry.submenu && (e.key === "ArrowRight" || e.key === "Enter")) {
                  e.preventDefault();
                  openSub(index, e.currentTarget);
                }
              }}
              onClick={(e) => {
                if (entry.submenu) return openSub(index, e.currentTarget);
                onDone();
                entry.onSelect?.();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-[14px] px-3 py-[7px] text-left text-[13px] font-semibold outline-none transition-colors duration-100",
                "hover:bg-white/[0.1] focus-visible:bg-white/[0.1] focus-visible:outline-none disabled:opacity-40",
                entry.danger ? "text-bad" : "text-ink",
                sub?.index === index && "bg-white/[0.1]",
              )}
            >
              {Icon ? <Icon className={cn("size-4 shrink-0", entry.danger ? "text-bad" : "text-ink-2")} strokeWidth={1.9} /> : <span className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.submenu && <ChevronRight className="size-4 text-ink-3" />}
            </button>
          );
        })}
      </motion.div>
      {sub && subEntries && <MenuPanel key={sub.index} entries={subEntries} x={sub.x} y={sub.y} alignRight={sub.alignRight} onDone={onDone} />}
    </>
  );
}

export function ContextMenu() {
  const menu = useMenu((s) => s.menu);
  const close = useMenu((s) => s.close);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close();
    const events = ["pointerdown", "resize", "blur", "wheel"] as const;
    events.forEach((name) => window.addEventListener(name, close, { passive: true }));
    window.addEventListener("keydown", onKey);
    return () => {
      events.forEach((name) => window.removeEventListener(name, close));
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  return <AnimatePresence>{menu && <MenuPanel key={`${menu.x},${menu.y}`} entries={menu.entries} x={menu.x} y={menu.y} onDone={close} />}</AnimatePresence>;
}
