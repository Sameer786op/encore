import type { ReactNode } from "react";
import { motion } from "motion/react";
import { AudioLines, ChartColumnBig, HardDrive, Heart, History, House, Import, Library, ListMusic, Plus, Search, Settings } from "lucide-react";
import { isWaiting, useImports, useLocal } from "@/imports/store";
import { useLibrary } from "@/library/store";
import { navigate, useNav, type Route } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { cn } from "@/lib/cn";
import { openMenu } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { useUpdates } from "@/ui/updates";
import { Mosaic } from "./Artwork";
import { LiquidGlass } from "./LiquidGlass";
import { PlayingBars } from "./PlayingBars";
import { playlistMenu } from "./playlistMenu";
import { SEARCH_INPUT_ID } from "./TopBar";

function isActive(current: Route, target: Route): boolean {
  if (current.name !== target.name) return false;
  return !("id" in target) || ("id" in current && current.id === target.id);
}

/** one row in the sidebar; the selection is a single highlight that glides between rows */
function Item({ route, icon, label, onClick, trailing, onContextMenu }: { route: Route; icon: ReactNode; label: string; onClick?: () => void; trailing?: ReactNode; onContextMenu?: (e: React.MouseEvent) => void }) {
  const current = useNav((s) => s.route);
  const active = isActive(current, route);
  return (
    <button
      onClick={onClick ?? (() => navigate(route))}
      onContextMenu={onContextMenu}
      className={cn("group relative flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] font-medium transition-colors duration-200", active ? "text-ink" : "text-ink/85 hover:bg-white/[0.05]")}
    >
      {active && (
        <motion.span
          layoutId="sidebar-selection"
          className="absolute inset-0 rounded-[10px] bg-white/[0.11] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.12)]"
          transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.8 }}
        />
      )}
      <span className="relative grid size-[22px] shrink-0 place-items-center text-accent">{icon}</span>
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      {trailing && <span className="relative shrink-0">{trailing}</span>}
    </button>
  );
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between pl-2.5 pr-1 pt-3">
      <span className="text-[11.5px] font-semibold text-ink-3">{children}</span>
      {action}
    </div>
  );
}

const ICON = "size-[18px]";

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

  return (
    <LiquidGlass as="aside" radius={22} sheen className="absolute bottom-2 left-2 top-2 z-30 flex w-[var(--sidebar-w)] flex-col overflow-hidden">
      <div className="drag flex h-[54px] shrink-0 items-center gap-2.5 px-4">
        <div className="grid size-[26px] place-items-center rounded-[8px] bg-gradient-to-b from-[#ff5a6e] to-[#e8193a] shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.45),0_4px_12px_-4px_rgb(250_45_72/0.8)]">
          <AudioLines className="size-[15px] text-white" strokeWidth={2.6} />
        </div>
        <span className="font-display text-[17px] font-bold tracking-[-0.02em]">Encore</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2 scrollbar-none [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%_-_16px),transparent)]">
        <nav className="flex flex-col gap-px pt-1">
          <Item route={{ name: "home" }} icon={<House className={ICON} />} label="Home" />
          <Item
            route={{ name: "search" }}
            icon={<Search className={ICON} />}
            label="Search"
            onClick={() => {
              navigate({ name: "search" });
              requestAnimationFrame(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
            }}
          />
        </nav>

        <Heading>Library</Heading>
        <div className="flex flex-col gap-px">
          <Item route={{ name: "library" }} icon={<Library className={ICON} />} label="Your Library" />
          <Item route={{ name: "liked" }} icon={<Heart className={ICON} />} label="Liked Songs" trailing={bars("liked")} />
          <Item route={{ name: "history" }} icon={<History className={ICON} />} label="Recently played" />
          <Item route={{ name: "listening" }} icon={<ChartColumnBig className={ICON} />} label="Your listening" />
          <Item
            route={{ name: "local" }}
            icon={<HardDrive className={ICON} />}
            label="Local files"
            trailing={bars("local-files") || (localCount > 0 && <span className="text-[11.5px] tabular-nums text-ink-3">{localCount}</span>)}
          />
        </div>

        <Heading
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
              key={p.id}
              route={{ name: "playlist", id: p.id }}
              icon={<Mosaic sources={p.items.map((i) => i.track.artwork)} className="size-[22px] rounded-[5px]" fallback={<ListMusic className="size-3" />} />}
              label={p.name}
              trailing={bars(p.id)}
              onContextMenu={(e) => openMenu(e, playlistMenu(p))}
            />
          ))}
          {playlists.length === 0 && (
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

      <div className="flex shrink-0 flex-col gap-px border-t border-white/[0.07] px-2.5 py-2">
        <Item
          route={{ name: "import" }}
          icon={<Import className={ICON} />}
          label="Import"
          trailing={
            waitingJobs.length > 0 && (
              <span className={cn("grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-semibold", matching ? "bg-white/12 text-ink-2" : "bg-accent text-white")}>
                {waitingJobs.length}
              </span>
            )
          }
        />
        <Item
          route={{ name: "settings" }}
          icon={<Settings className={ICON} />}
          label="Settings"
          trailing={updateReady && <span title="An update is ready" className="size-2 rounded-full bg-accent" />}
        />
      </div>
    </LiquidGlass>
  );
}
