import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChartColumnBig, HardDrive, Heart, History, House, Import, Library, ListMusic, Plus, Search, Settings } from "lucide-react";
import { isWaiting, useImports, useLocal } from "@/imports/store";
import { useLibrary } from "@/library/store";
import { navigate, useNav, type Route } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { useUpdates } from "@/ui/updates";
import { Mosaic } from "./Artwork";
import { LiquidGlass } from "./LiquidGlass";
import { Logo } from "./Logo";
import { ServiceIcon } from "./ServiceIcon";
import { PlayingBars } from "./PlayingBars";
import { playlistMenu } from "./playlistMenu";
import { SEARCH_INPUT_ID } from "./TopBar";

// in narrow windows the sidebar keeps only its icons; styles.css narrows --sidebar-w at the same width
const COMPACT_QUERY = "(max-width: 1099px)";

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const query = matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return compact;
}

function isActive(current: Route, target: Route): boolean {
  if (current.name !== target.name) return false;
  return !("id" in target) || ("id" in current && current.id === target.id);
}

interface ItemProps {
  route: Route;
  icon: ReactNode;
  label: string;
  /** a second line under the label, for playlists */
  sub?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  /** a dot on the icon when there's no room for the trailing badge */
  dot?: boolean;
  compact: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/** one row in the sidebar; the selection is a single highlight that glides between rows, with an ember spark at its end */
function Item({ route, icon, label, sub, onClick, trailing, dot, compact, onContextMenu }: ItemProps) {
  const current = useNav((s) => s.route);
  const active = isActive(current, route);
  return (
    <button
      onClick={onClick ?? (() => navigate(route))}
      onContextMenu={onContextMenu}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      className={cn(
        "group relative flex w-full items-center rounded-[14px] text-left text-[13.5px] font-semibold transition-colors duration-200",
        compact ? "h-10 justify-center" : sub ? "h-[46px] gap-2.5 px-2" : "h-[38px] gap-3 px-2.5",
        active ? "text-ink" : "text-ink-2 hover:bg-white/[0.05] hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-selection"
          className="absolute inset-0 rounded-[14px] bg-[var(--row-on)] shadow-[inset_0_0_0_0.5px_var(--glass-rim),0_4px_14px_-6px_rgb(0_0_0/calc(0.3*var(--shadow-k)))]"
          transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.8 }}
        />
      )}
      <span className={cn("relative grid shrink-0 place-items-center transition-colors duration-200", sub ? "size-[34px]" : "size-[20px]", active ? "text-accent-ink" : "text-ink-2 group-hover:text-ink")}>
        {icon}
        {compact && dot && <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-[rgb(var(--glass-rgb))]" />}
      </span>
      {!compact && (
        <span className="relative min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {sub && <span className="block truncate text-[11.5px] font-medium text-ink-3">{sub}</span>}
        </span>
      )}
      {!compact && trailing ? (
        <span className="relative shrink-0">{trailing}</span>
      ) : (
        !compact && active && <span aria-hidden className="relative mr-0.5 size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_10px_rgb(var(--accent-rgb)),0_0_3px_rgb(var(--accent-rgb))]" />
      )}
    </button>
  );
}

function Heading({ children, action, compact }: { children: ReactNode; action?: ReactNode; compact: boolean }) {
  // icons only: a hairline stands in for the heading, keeping its button
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1 pt-2.5">
        <div className="mx-2 h-px self-stretch bg-white/[0.08]" />
        {action}
      </div>
    );
  }
  return (
    <div className="flex h-9 items-center justify-between pl-2.5 pr-1 pt-4">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-3">{children}</span>
      {action}
    </div>
  );
}

const ICON = "size-[18px] stroke-[1.9]";

export function Sidebar() {
  const playlists = useLibrary((s) => s.snapshot.playlists);
  const contextId = usePlayer((s) => s.queue.context?.id);
  const jobs = useImports((s) => s.jobs);
  const waitingJobs = jobs.filter(isWaiting);
  const updateReady = useUpdates((s) => s.state === "ready");
  const matching = waitingJobs.some((j) => j.status === "matching");
  const localCount = useLocal((s) => s.state.tracks);
  const isPlaying = usePlayer((s) => s.status === "playing");
  const bars = (id: string) => contextId === id && isPlaying && <PlayingBars />;
  const compact = useCompact();

  return (
    <LiquidGlass as="aside" area="sidebar" radius={24} sheen className="absolute bottom-2 left-2 top-2 z-30 flex w-[var(--sidebar-w)] flex-col overflow-hidden">
      {/* an ember glow rising from the bottom corner, in Ember */}
      <span aria-hidden className="ember-only pointer-events-none absolute inset-0 -z-[1] bg-[radial-gradient(95%_38%_at_0%_100%,rgb(var(--accent-rgb)/0.2),transparent_72%)]" />
      <div className={cn("drag flex h-[62px] shrink-0 items-center gap-2.5", compact ? "justify-center" : "px-[18px]")}>
        <Logo className="size-[30px] drop-shadow-[0_6px_14px_rgb(var(--accent-rgb)/0.45)]" />
        {!compact && (
          <span aria-label="Vyse Music" className="font-display text-[25px] font-bold leading-none tracking-[-0.045em] whitespace-nowrap">
            vyse
          </span>
        )}
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto pb-2", compact ? "px-2" : "px-2.5", " scrollbar-none [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%_-_16px),transparent)]")}>
        <nav className="flex flex-col gap-px pt-1">
          <Item compact={compact} route={{ name: "home" }} icon={<House className={ICON} />} label="Home" />
          <Item
            compact={compact}
            route={{ name: "search" }}
            icon={<Search className={ICON} />}
            label="Search"
            onClick={() => {
              navigate({ name: "search" });
              requestAnimationFrame(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
            }}
          />
        </nav>

        <Heading compact={compact}>Library</Heading>
        <div className="flex flex-col gap-px">
          <Item compact={compact} route={{ name: "library" }} icon={<Library className={ICON} />} label="Your Library" />
          <Item compact={compact} route={{ name: "liked" }} icon={<Heart className={ICON} />} label="Liked Songs" trailing={bars("liked")} />
          <Item compact={compact} route={{ name: "history" }} icon={<History className={ICON} />} label="Recently played" />
          <Item compact={compact} route={{ name: "listening" }} icon={<ChartColumnBig className={ICON} />} label="Your listening" />
          <Item
            compact={compact}
            route={{ name: "local" }}
            icon={<HardDrive className={ICON} />}
            label="Local files"
            trailing={bars("local-files") || (localCount > 0 && <span className="text-[11.5px] tabular-nums text-ink-3">{localCount}</span>)}
          />
        </div>

        <Heading
          compact={compact}
          action={
            <button
              onClick={() => openModal({ kind: "create-playlist" })}
              aria-label="New playlist"
              title="New playlist"
              className="pressable grid size-6 place-items-center rounded-full text-ink-3 hover:bg-white/10 hover:text-ink"
            >
              <Plus className="size-4" />
            </button>
          }
        >
          Playlists
        </Heading>
        <div className="flex flex-col gap-px">
          {playlists.map((p) => (
            <Item
              compact={compact}
              key={p.id}
              route={{ name: "playlist", id: p.id }}
              icon={<Mosaic sources={p.items.map((i) => i.track.artwork)} className={compact ? "size-[24px] rounded-[6px]" : "size-[34px] rounded-[9px]"} fallback={<ListMusic className="size-4" />} />}
              label={p.name}
              sub={compact ? undefined : plural(p.items.length, "song")}
              trailing={bars(p.id) || (p.synced && <ServiceIcon service={p.synced.service} plain className="size-3 text-ink-3" />)}
              onContextMenu={(e) => openMenu(e, playlistMenu(p))}
            />
          ))}
          {playlists.length === 0 && !compact && (
            <button
              onClick={() => openModal({ kind: "create-playlist" })}
              className="pressable mt-1 rounded-[12px] px-2.5 py-2.5 text-left text-[12.5px] leading-snug text-ink-3 hover:bg-white/[0.05] hover:text-ink-2"
            >
              <span className="block font-medium text-ink-2">Create your first playlist</span>
              Collect the songs you love in one place.
            </button>
          )}
        </div>
      </div>

      <div className={cn("flex shrink-0 flex-col gap-px border-t border-white/[0.07] py-2", compact ? "px-2" : "px-2.5")}>
        <Item
          compact={compact}
          route={{ name: "import" }}
          icon={<Import className={ICON} />}
          label="Import"
          dot={waitingJobs.length > 0 && !matching}
          trailing={
            waitingJobs.length > 0 && (
              <span className={cn("grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-semibold", matching ? "bg-white/12 text-ink-2" : "bg-accent text-on-accent")}>
                {waitingJobs.length}
              </span>
            )
          }
        />
        <Item
          compact={compact}
          route={{ name: "settings" }}
          icon={<Settings className={ICON} />}
          label="Settings"
          dot={updateReady}
          trailing={updateReady && <span title="An update is ready" className="size-2 rounded-full bg-accent" />}
        />
      </div>
    </LiquidGlass>
  );
}
