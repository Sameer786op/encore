import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Copy, LoaderCircle } from "lucide-react";
import { myJamId, useJam } from "@/jam/store";
import type { Person } from "@/jam/protocol";
import { cn } from "@/lib/cn";
import { toast } from "@/ui/toast";

// Start a Jam, join one with a code, and see who's in it; from the Jam button in the player bar.

const WIDTH = 340;
const MARGIN = 12;

/** a person's initial on a colour of their own, the same on every computer */
export function JamAvatar({ name, className }: { name: string; className?: string }) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      style={{ background: `hsl(${hue} 62% 46%)` }}
      className={cn("grid shrink-0 place-items-center rounded-full font-display font-semibold text-white shadow-[0_0_0_1.5px_rgb(0_0_0/0.25)]", className)}
    >
      {[...name][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** in a Jam as a guest, where the host chooses what plays */
export const useJamGuest = () => useJam((s) => s.role === "guest" && (s.status === "joined" || s.status === "reconnecting"));

const input =
  "h-10 w-full rounded-[12px] border border-transparent bg-white/[0.07] px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent/60";
const accentButton =
  "pressable inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[13.5px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-50";
const plainButton = "glass-control pressable inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[13.5px] font-medium hover:brightness-125 disabled:opacity-50";

function People({ people }: { people: Person[] }) {
  return (
    <ul aria-label="People in the Jam" className="max-h-[200px] space-y-1 overflow-y-auto">
      {people.map((p, i) => (
        <motion.li
          key={p.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 36, delay: Math.min(i, 6) * 0.03 }}
          className="flex items-center gap-2.5 rounded-[12px] px-1.5 py-1"
        >
          <JamAvatar name={p.name} className="size-7 text-[12px]" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {p.name}
            {p.id === myJamId && <span className="font-normal text-ink-3"> (you)</span>}
          </span>
          {p.host && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-ink">Host</span>}
        </motion.li>
      ))}
    </ul>
  );
}

function Start() {
  const saved = useJam((s) => s.name);
  const error = useJam((s) => s.error);
  const [name, setName] = useState(saved);
  const [code, setCode] = useState("");
  const named = name.trim().length > 0;
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (named && code.trim()) useJam.getState().join(code, name);
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-[17px] font-bold tracking-[-0.02em]">Jam</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
          Listen together, each on your own computer. Everyone hears the same song at the same moment, and anyone can add songs.
        </p>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="What friends see" autoComplete="off" spellCheck={false} className={input} />
      </label>
      <button onClick={() => useJam.getState().start(name)} disabled={!named} className={cn(accentButton, "w-full")}>
        Start a Jam
      </button>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
        <span className="h-px flex-1 bg-white/10" />
        or join one
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={join} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Jam code"
          aria-label="Jam code"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className={cn(input, "font-mono uppercase tracking-[0.08em] placeholder:font-sans placeholder:normal-case placeholder:tracking-normal")}
        />
        <button type="submit" disabled={!named || !code.trim()} className={cn(plainButton, "shrink-0")}>
          Join
        </button>
      </form>
      {error && <p className="text-[12.5px] leading-relaxed text-bad">{error}</p>}
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        Friends need Vyse Music too. You connect straight to each other, so people in a Jam can see each other's IP address. No sound is sent: everyone plays the songs
        from YouTube Music.
      </p>
    </div>
  );
}

function Hosting() {
  const code = useJam((s) => s.code) ?? "";
  const people = useJam((s) => s.people);
  const copy = () =>
    void navigator.clipboard.writeText(code).then(
      () => toast("Jam code copied"),
      () => undefined,
    );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative size-2.5 rounded-full bg-accent" />
        </span>
        <h2 className="font-display text-[17px] font-bold tracking-[-0.02em]">Your Jam is on</h2>
      </div>
      <div className="rounded-[16px] bg-white/[0.06] px-4 py-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Jam code</div>
        <div className="mt-1 flex items-center gap-2">
          <span aria-label="Jam code" className="min-w-0 flex-1 select-all whitespace-nowrap font-mono text-[20px] font-semibold tracking-[0.06em]">
            {code}
          </span>
          <button onClick={copy} aria-label="Copy the Jam code" title="Copy" className="glass-control pressable grid size-9 shrink-0 place-items-center rounded-full hover:brightness-125">
            <Copy className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-3">Send it to friends. They join from the Jam button in their player.</p>
      </div>
      <People people={people} />
      {people.length === 1 && <p className="text-[12.5px] text-ink-3">Waiting for friends to join…</p>}
      <button onClick={() => useJam.getState().leave()} className={cn(plainButton, "w-full text-bad")}>
        End Jam
      </button>
    </div>
  );
}

function Joined() {
  const status = useJam((s) => s.status);
  const people = useJam((s) => s.people);
  const hostName = useJam((s) => s.hostName) ?? "The host";
  return (
    <div className="space-y-4">
      <h2 className="font-display text-[17px] font-bold tracking-[-0.02em]">{hostName}'s Jam</h2>
      {status === "reconnecting" && (
        <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <LoaderCircle className="size-3.5 animate-spin" /> Lost {hostName} for a moment. Reconnecting…
        </p>
      )}
      <People people={people} />
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        {hostName} chooses what plays. Add songs from anywhere with Add to queue or Play next, and they go into the Jam. Pausing only pauses it for you.
      </p>
      <button onClick={() => useJam.getState().leave()} className={cn(plainButton, "w-full")}>
        Leave Jam
      </button>
    </div>
  );
}

function Joining() {
  const code = useJam((s) => s.code);
  return (
    <div className="space-y-4">
      <h2 className="font-display text-[17px] font-bold tracking-[-0.02em]">Joining</h2>
      <p className="flex items-center gap-2.5 text-[13px] text-ink-2">
        <LoaderCircle className="size-4 animate-spin" />
        Looking for the Jam <span className="font-mono tracking-[0.06em] text-ink">{code}</span>
      </p>
      <button onClick={() => useJam.getState().leave()} className={cn(plainButton, "w-full")}>
        Cancel
      </button>
    </div>
  );
}

function Panel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const status = useJam((s) => s.status);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, bottom: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(window.innerWidth - WIDTH - MARGIN, Math.max(MARGIN, rect.left + rect.width / 2 - WIDTH / 2));
      setPos(rect.top < window.innerHeight / 2 ? { left, top: rect.bottom + 12 } : { left, bottom: window.innerHeight - rect.top + 12 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      anchor.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, onClose]);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="Jam"
      initial={{ opacity: 0, scale: 0.92, y: pos.top !== undefined ? -8 : 8, filter: "blur(3px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.14, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ type: "spring", stiffness: 560, damping: 38, mass: 0.7, filter: { duration: 0.18, ease: "easeOut" } }}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: WIDTH }}
      className={cn("glass-menu fixed z-50 rounded-[20px] p-4", pos.top !== undefined ? "origin-top" : "origin-bottom")}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={status === "reconnecting" ? "joined" : status}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(4px)" }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
        >
          {status === "off" ? <Start /> : status === "hosting" ? <Hosting /> : status === "joining" ? <Joining /> : <Joined />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

export function JamPanel({ anchor, open, onClose }: { anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  return createPortal(<AnimatePresence>{open && anchor && <Panel anchor={anchor} onClose={onClose} />}</AnimatePresence>, document.body);
}
