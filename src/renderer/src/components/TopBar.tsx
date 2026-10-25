import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Clock3, Play, Search, X } from "lucide-react";
import type { SearchSuggestions, SuggestedItem } from "@shared/types";
import { navigate, useNav } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { useSearch } from "@/search/store";
import { useSettings } from "@/settings/store";
import { comboParts, keysFor } from "@/ui/shortcuts";
import { cn } from "@/lib/cn";
import { Artwork } from "./Artwork";
import { LiquidGlass } from "./LiquidGlass";

export const SEARCH_INPUT_ID = "encore-search";

type Option = { type: "query"; value: string } | { type: "item"; item: SuggestedItem };

const NO_SUGGESTIONS: SearchSuggestions = { queries: [], items: [] };

function itemTitle(item: SuggestedItem): string {
  return item.kind === "track" ? item.track.title : item.kind === "artist" ? item.artist.name : item.kind === "album" ? item.album.title : item.playlist.title;
}

function itemArtwork(item: SuggestedItem): string | undefined {
  return item.kind === "track" ? item.track.artwork : item.kind === "artist" ? item.artist.artwork : item.kind === "album" ? item.album.artwork : item.playlist.artwork;
}

const optionKey = (o: Option) => (o.type === "query" ? `q:${o.value}` : `${o.item.kind}:${itemTitle(o.item)}:${itemArtwork(o.item) ?? ""}`);

function SearchBox() {
  const route = useNav((s) => s.route);
  // the box only shows the search while you're on Search; going back there brings it back
  const stored = useSearch((s) => s.query);
  const query = route.name === "search" ? stored : "";
  const recent = useSearch((s) => s.recent);
  const setQuery = useSearch((s) => s.setQuery);
  const submit = useSearch((s) => s.submit);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestions>(NO_SUGGESTIONS);
  const [highlight, setHighlight] = useState(-1);
  const searchKeys = keysFor(useSettings((s) => s.shortcuts)).search[0];

  // fetch suggestions as the user types
  useEffect(() => {
    const q = query.trim();
    if (!q || !focused) return setSuggestions(NO_SUGGESTIONS);
    let cancelled = false;
    const timer = setTimeout(() => {
      window.encore.catalog
        .suggestions(q)
        .then((found) => !cancelled && setSuggestions(found))
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, focused]);

  // searches YouTube Music suggests, then songs, artists, albums and playlists to open right away
  const options: Option[] = query.trim()
    ? [...suggestions.queries.map((value) => ({ type: "query" as const, value })), ...suggestions.items.map((item) => ({ type: "item" as const, item }))]
    : recent.slice(0, 6).map((value) => ({ type: "query" as const, value }));
  const open = focused && options.length > 0;
  const firstItem = options.findIndex((o) => o.type === "item");
  useEffect(() => setHighlight(-1), [query, focused]);

  const close = () => {
    setFocused(false);
    input.current?.blur();
  };

  const choose = (option: Option) => {
    if (option.type === "query") {
      submit(option.value);
      navigate({ name: "search" });
      return close();
    }
    // the search stays behind, for going back to it
    if (query.trim()) submit(query);
    const item = option.item;
    if (item.kind === "track") usePlayer.getState().playTracks([item.track], 0, { kind: "search", label: `"${query.trim()}"` });
    else if (item.kind === "artist") navigate({ name: "artist", id: item.artist.id });
    else if (item.kind === "album") navigate({ name: "album", id: item.album.id });
    else navigate({ name: "ytplaylist", id: item.playlist.id });
    close();
  };

  return (
    <div className="no-drag relative w-[min(400px,38vw)]">
      <LiquidGlass
        radius={19}
        bezel={10}
        strength={10}
        material="glass-control"
        className={cn("flex h-[38px] items-center gap-2 px-3.5 transition-[box-shadow,filter] duration-300", focused ? "brightness-125" : "hover:brightness-110")}
      >
        <Search className="size-[15px] shrink-0 text-ink-2" strokeWidth={2.4} />
        <input
          id={SEARCH_INPUT_ID}
          ref={input}
          value={query}
          placeholder="Search songs, artists, albums"
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (route.name !== "search") navigate({ name: "search" });
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && open) {
              e.preventDefault();
              setHighlight((h) => Math.min(options.length - 1, h + 1));
            } else if (e.key === "ArrowUp" && open) {
              e.preventDefault();
              setHighlight((h) => Math.max(-1, h - 1));
            } else if (e.key === "Enter") {
              choose(highlight >= 0 ? options[highlight] : { type: "query", value: query });
            } else if (e.key === "Escape") {
              input.current?.blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            aria-label="Clear search"
            className="rounded-full p-0.5 text-ink-3 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
        {searchKeys && <kbd className={cn("hidden rounded-md bg-white/[0.07] px-1.5 py-px font-sans text-[10.5px] text-ink-3 lg:block", (focused || query) && "lg:hidden")}>{comboParts(searchKeys).join(" ")}</kbd>}
      </LiquidGlass>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 36 }}
            style={{ transformOrigin: "top center" }}
            className="glass-menu absolute inset-x-0 top-[46px] z-30 overflow-hidden rounded-[18px] p-1.5"
          >
            {!query.trim() && <li className="px-3 pb-1 pt-1.5 text-[11.5px] font-semibold text-ink-3">Recent searches</li>}
            {options.map((option, i) => (
              <li key={optionKey(option)} role="option" aria-selected={i === highlight}>
                {i === firstItem && i > 0 && <div aria-hidden className="mx-3 my-1.5 h-px bg-white/[0.08]" />}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[11px] text-left text-[13.5px] transition-colors duration-100",
                    option.type === "query" ? "px-3 py-[7px]" : "px-2 py-1.5",
                    i === highlight ? "bg-white/[0.1] text-ink" : "text-ink-2",
                  )}
                >
                  {option.type === "query" ? (
                    <>
                      {query.trim() ? <Search className="size-4 shrink-0 text-ink-3" /> : <Clock3 className="size-4 shrink-0 text-ink-3" />}
                      <span className="truncate">{option.value}</span>
                    </>
                  ) : (
                    <>
                      <span className="relative shrink-0">
                        <Artwork src={itemArtwork(option.item)} className={cn("size-10", option.item.kind === "artist" ? "rounded-full" : "rounded-[7px]")} />
                        {option.item.kind === "track" && (
                          <span className={cn("absolute inset-0 grid place-items-center rounded-[7px] bg-black/45 text-white transition-opacity duration-150", i === highlight ? "opacity-100" : "opacity-0")}>
                            <Play className="ml-px size-4" fill="currentColor" strokeWidth={0} />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{itemTitle(option.item)}</span>
                        <span className="block truncate text-[12px] text-ink-3">{option.item.subtitle}</span>
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar({ scrolled, right }: { scrolled: boolean; right: number }) {
  const index = useNav((s) => s.index);
  const length = useNav((s) => s.stack.length);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);
  return (
    <div
      className="drag absolute top-0 z-20 flex h-[56px] items-center gap-2.5 pl-4"
      // with the queue closed, leave room for the native window buttons
      style={{ left: "calc(var(--sidebar-w) + 8px)", right, paddingRight: right ? 16 : 150 }}
    >
      {/* the scroll edge: once the page slides under the toolbar, it softens and dims there */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-[84px] bg-gradient-to-b from-[rgb(var(--backdrop-tint)/0.7)] via-[rgb(var(--backdrop-tint)/0.3)] to-transparent backdrop-blur-[10px] transition-opacity duration-500 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      />
      <LiquidGlass radius={19} bezel={10} strength={10} material="glass-control" className="no-drag flex h-[38px] items-center px-0.5">
        <button onClick={back} disabled={index === 0} aria-label="Go back" className="pressable grid h-[34px] w-9 place-items-center rounded-full text-ink hover:bg-white/[0.08] disabled:text-ink-3 disabled:hover:bg-transparent">
          <ChevronLeft className="size-[19px]" strokeWidth={2.3} />
        </button>
        <span className="h-4 w-px bg-white/10" />
        <button onClick={forward} disabled={index >= length - 1} aria-label="Go forward" className="pressable grid h-[34px] w-9 place-items-center rounded-full text-ink hover:bg-white/[0.08] disabled:text-ink-3 disabled:hover:bg-transparent">
          <ChevronRight className="size-[19px]" strokeWidth={2.3} />
        </button>
      </LiquidGlass>
      <SearchBox />
    </div>
  );
}
