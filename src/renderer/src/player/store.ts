import { create } from "zustand";
import { scrobbleThreshold } from "@shared/scrobbleRules";
import type { Track } from "@shared/types";
import { useLibrary } from "@/library/store";
import { useSettings } from "@/settings/store";
import { toast } from "@/ui/toast";
import { AudioEngine } from "./engine";
import { fadeLength, levellingDb, shouldCrossfade, shouldPreload } from "./transitions";
import {
  addToQueue,
  clearUpcoming,
  currentItem,
  cycleRepeat,
  emptyQueue,
  jumpTo,
  loadQueue,
  nextIndex,
  playNext,
  previousIndex,
  removeItem,
  reorderUpcoming,
  setIndex,
  setShuffle,
  upcomingItems,
  type PlayContext,
  type QueueState,
} from "./queue";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused";

interface PlayerStore {
  queue: QueueState;
  status: PlaybackStatus;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** keep playing similar songs when the queue runs out */
  autoplay: boolean;
  queueOpen: boolean;
  radioLoading: boolean;

  playTracks(tracks: Track[], startIndex: number, context: PlayContext | null): void;
  togglePlay(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): void;
  jumpTo(uid: string): void;
  removeFromQueue(uid: string): void;
  reorderUpcoming(uids: string[]): void;
  clearUpcoming(): void;
  startRadio(track: Track): Promise<void>;
  setAutoplay(on: boolean): void;
  setQueueOpen(open: boolean): void;
}

const STORAGE_KEY = "encore.player.v1";
const MAX_SAVED_ITEMS = 1000;
const MAX_FAILURES_IN_A_ROW = 3;
/** the song counts as "played" for history after this much listening */
const MIN_LISTEN_MS = 30_000;

let engine: AudioEngine | null = null;
let failuresInARow = 0;
// queue items we already got ready, faded into, or asked radio about
let preparedFor = "";
let crossfadedFrom = "";
let radioAskedFor = "";

// how much of the current song was actually heard, for play history and scrobbling
const listening = { trackId: "", track: null as Track | null, ms: 0, lastPosition: 0, startedAt: 0, scrobbled: false };

function startListening(track: Track | null): void {
  finishListening();
  listening.trackId = track?.id ?? "";
  listening.track = track;
  listening.ms = 0;
  listening.lastPosition = 0;
  listening.startedAt = 0;
  listening.scrobbled = false;
}

/** once enough of the song has been heard, it goes to Last.fm and ListenBrainz (if connected) */
function maybeScrobble(durationSeconds: number): void {
  const { track } = listening;
  if (!track || listening.scrobbled) return;
  // songs found through history may not know their length until they play
  const durationMs = track.durationMs || Math.round(durationSeconds * 1000);
  const threshold = scrobbleThreshold(durationMs);
  if (threshold === null || listening.ms < threshold) return;
  listening.scrobbled = true;
  window.encore.scrobble.played({ ...track, durationMs }, listening.startedAt || Date.now() - listening.ms, listening.ms);
}

function finishListening(): void {
  const { track, ms } = listening;
  if (track && ms >= Math.min(MIN_LISTEN_MS, (track.durationMs || MIN_LISTEN_MS * 2) / 2)) {
    useLibrary.getState().recordPlay(track, ms);
  }
  listening.track = null;
  listening.ms = 0;
}

interface SavedPlayer {
  queue: QueueState;
  position: number;
  volume: number;
  muted: boolean;
  autoplay: boolean;
}

function loadSaved(): Partial<SavedPlayer> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<SavedPlayer>;
  } catch {
    return {};
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}

function saveNow(): void {
  const s = usePlayer.getState();
  let queue = s.queue;
  if (queue.items.length > MAX_SAVED_ITEMS) {
    // keep a window around the current song
    const start = Math.max(0, Math.min(queue.index - 100, queue.items.length - MAX_SAVED_ITEMS));
    const items = queue.items.slice(start, start + MAX_SAVED_ITEMS);
    const keep = new Set(items.map((i) => i.uid));
    queue = { ...queue, items, index: queue.index - start, unshuffled: queue.unshuffled?.filter((u) => keep.has(u)) ?? null };
  }
  const saved: SavedPlayer = { queue, position: s.position, volume: s.volume, muted: s.muted, autoplay: s.autoplay };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // storage full or unavailable: the queue just won't survive a restart
  }
}

const saved = loadSaved();

export const usePlayer = create<PlayerStore>((set, get) => {
  /** look up how loud a song is, so the levelling can even it out */
  function requestLevel(track: Track): void {
    const e = getEngine();
    if (e.hasTrackLevel(track.id)) return;
    if (track.source === "local") {
      e.setTrackLevel(track.id, levellingDb({ replayGainDb: track.gainDb }));
      return;
    }
    void window.encore.catalog
      .loudness(track.id)
      .then((db) => e.setTrackLevel(track.id, levellingDb({ youtubeLoudnessDb: db })))
      .catch(() => undefined);
  }

  /** the song that will play when this one ends on its own, if it's a different one */
  function upcomingAuto(): { uid: string; track: Track; index: number } | null {
    const queue = get().queue;
    const index = nextIndex(queue, true);
    if (index === null || index === queue.index) return null;
    const item = queue.items[index];
    return item ? { uid: item.uid, track: item.track, index } : null;
  }

  /** move to the next song while both play, then let the old one go */
  function startCrossfade(index: number, seconds: number): void {
    const item = get().queue.items[index];
    if (!item) return;
    set({ queue: setIndex(get().queue, index) });
    startListening(item.track);
    getEngine().crossfadeTo(item.track, seconds);
    set({ status: "playing", position: 0, duration: item.track.durationMs / 1000 });
    scheduleSave();
    if (get().queue.context?.kind === "radio" && upcomingItems(get().queue).length <= 2) void extendWithRadio();
  }

  function getEngine(): AudioEngine {
    if (engine) return engine;
    engine = new AudioEngine({
      onTime(seconds) {
        const { status, duration, queue } = get();
        if (status === "playing") {
          const delta = seconds - listening.lastPosition;
          if (delta > 0 && delta < 1.5) {
            listening.startedAt ||= Date.now() - delta * 1000;
            listening.ms += delta * 1000;
            maybeScrobble(duration);
          }
        }
        listening.lastPosition = seconds;
        set({ position: seconds });
        if (status !== "playing" || duration <= 0) return;

        const current = currentItem(queue);
        const remaining = duration - seconds;
        const settings = useSettings.getState();
        let next = upcomingAuto();

        // the queue is about to run out: find similar songs early so the handover is smooth
        if (!next && current && get().autoplay && shouldPreload(remaining, settings.crossfadeSeconds) && radioAskedFor !== current.uid) {
          radioAskedFor = current.uid;
          void extendWithRadio();
        }
        if (!next) return;

        // get the next song buffered and measured so it starts without a gap
        if (shouldPreload(remaining, settings.crossfadeSeconds) && preparedFor !== next.uid) {
          preparedFor = next.uid;
          void window.encore.catalog.prefetch(next.track.id);
          getEngine().preload(next.track);
          requestLevel(next.track);
        }

        const fade = fadeLength(settings.crossfadeSeconds, duration, next.track.durationMs / 1000);
        if (
          current &&
          shouldCrossfade({
            remaining,
            crossfadeSeconds: fade,
            next: next.track,
            current: current.track,
            crossfadeSameAlbum: settings.crossfadeSameAlbum,
            alreadyStarted: crossfadedFrom === current.uid,
          })
        ) {
          crossfadedFrom = current.uid;
          next = upcomingAuto();
          if (next) startCrossfade(next.index, Math.min(fade, remaining));
        }
      },
      onDuration: (seconds) => set({ duration: seconds }),
      onPlaying() {
        failuresInARow = 0;
        set({ status: "playing" });
      },
      onPaused: () => set({ status: get().queue.index >= 0 ? "paused" : "idle" }),
      onWaiting: () => set({ status: "loading" }),
      onEnded: () => void advance(true),
      onFailed(track) {
        failuresInARow += 1;
        if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
          failuresInARow = 0;
          set({ status: "paused" });
          toast("Playback stopped: several songs in a row wouldn't load. Check your connection.", { kind: "error", durationMs: 6000 });
          return;
        }
        toast(`Couldn't play "${track.title}", skipping`, { kind: "error" });
        void advance(true);
      },
    });
    engine.setVolume(get().volume, get().muted);
    const settings = useSettings.getState();
    engine.setEq(settings.eq);
    engine.setLevelling(settings.levelling);
    useSettings.subscribe((s, before) => {
      if (s.eq !== before.eq) engine?.setEq(s.eq);
      if (s.levelling !== before.levelling) engine?.setLevelling(s.levelling);
    });
    return engine;
  }

  /** load whatever the queue says is current */
  function loadCurrent(autoplay: boolean, startAt = 0): void {
    const item = currentItem(get().queue);
    const e = getEngine();
    if (!item) {
      startListening(null);
      e.unload();
      set({ status: "idle", position: 0, duration: 0 });
      return;
    }
    startListening(item.track);
    listening.lastPosition = startAt;
    requestLevel(item.track);
    e.load(item.track, { autoplay, startAt });
    set({ status: autoplay ? "loading" : "paused", position: startAt, duration: item.track.durationMs / 1000 });
    scheduleSave();
  }

  async function extendWithRadio(): Promise<number> {
    const { queue, radioLoading } = get();
    const seed = queue.items[queue.items.length - 1]?.track;
    if (!seed || radioLoading) return 0;
    set({ radioLoading: true });
    try {
      const known = new Set(queue.items.slice(-300).map((i) => i.track.id));
      const more = (await window.encore.catalog.radio(seed)).filter((t) => !known.has(t.id));
      if (more.length > 0) set({ queue: addToQueue(get().queue, more) });
      return more.length;
    } catch {
      return 0;
    } finally {
      set({ radioLoading: false });
    }
  }

  async function advance(auto: boolean): Promise<void> {
    let target = nextIndex(get().queue, auto);
    if (target === null && get().autoplay && get().queue.items.length > 0) {
      const added = await extendWithRadio();
      if (added > 0) target = nextIndex(get().queue, auto);
    }
    if (target === null) {
      // end of the queue: stay on the last song, rewound and paused
      finishListening();
      getEngine().pause();
      getEngine().seek(0);
      startListening(currentItem(get().queue)?.track ?? null);
      set({ status: "paused", position: 0 });
      return;
    }
    if (target === get().queue.index) {
      startListening(currentItem(get().queue)?.track ?? null);
      getEngine().seek(0);
      getEngine().play();
      return;
    }
    set({ queue: setIndex(get().queue, target) });
    loadCurrent(true);
    // radio never ends: top it up before it runs dry
    if (get().queue.context?.kind === "radio" && upcomingItems(get().queue).length <= 2) void extendWithRadio();
  }

  const restored = saved.queue ? currentItem(saved.queue) : null;
  return {
    queue: saved.queue ?? emptyQueue,
    status: restored ? "paused" : "idle",
    position: restored ? (saved.position ?? 0) : 0,
    duration: restored ? restored.track.durationMs / 1000 : 0,
    volume: saved.volume ?? 0.8,
    muted: saved.muted ?? false,
    autoplay: saved.autoplay ?? true,
    queueOpen: false,
    radioLoading: false,

    playTracks(tracks, startIndex, context) {
      if (tracks.length === 0) return;
      set({ queue: loadQueue(get().queue, tracks, startIndex, context) });
      loadCurrent(true);
    },

    togglePlay() {
      const { status, queue, position } = get();
      const e = getEngine();
      if (queue.index < 0) return;
      if (!e.currentTrack) {
        // first play after a restart: the saved song isn't loaded yet
        loadCurrent(true, position);
        return;
      }
      if (status === "playing" || status === "loading") e.pause();
      else e.play();
    },

    next: () => void advance(false),

    previous() {
      const { position, queue } = get();
      if (position > 3 || (queue.index <= 0 && queue.repeat === "off")) {
        get().seek(0);
        return;
      }
      set({ queue: setIndex(queue, previousIndex(queue)) });
      loadCurrent(true);
    },

    seek(seconds) {
      const e = getEngine();
      const target = Math.max(0, Math.min(seconds, get().duration || seconds));
      if (!e.currentTrack && get().queue.index >= 0) {
        set({ position: target });
        scheduleSave();
        return;
      }
      listening.lastPosition = target;
      e.seek(target);
      set({ position: target });
    },

    setVolume(volume) {
      const v = Math.min(1, Math.max(0, volume));
      set({ volume: v, muted: v === 0 ? get().muted : false });
      getEngine().setVolume(v, get().muted);
      scheduleSave();
    },

    toggleMute() {
      const muted = !get().muted;
      set({ muted });
      getEngine().setVolume(get().volume, muted);
      scheduleSave();
    },

    toggleShuffle() {
      set({ queue: setShuffle(get().queue, !get().queue.shuffle) });
      scheduleSave();
    },

    cycleRepeat() {
      set({ queue: { ...get().queue, repeat: cycleRepeat(get().queue.repeat) } });
      scheduleSave();
    },

    playNext(tracks) {
      const wasEmpty = get().queue.index < 0;
      set({ queue: playNext(get().queue, tracks) });
      if (wasEmpty) loadCurrent(true);
      scheduleSave();
    },

    addToQueue(tracks) {
      const wasEmpty = get().queue.index < 0;
      set({ queue: addToQueue(get().queue, tracks) });
      if (wasEmpty) loadCurrent(true);
      scheduleSave();
    },

    jumpTo(uid) {
      set({ queue: jumpTo(get().queue, uid) });
      loadCurrent(true);
    },

    removeFromQueue(uid) {
      const { state, removedCurrent } = removeItem(get().queue, uid);
      set({ queue: state });
      if (removedCurrent) loadCurrent(get().status === "playing" || get().status === "loading");
      scheduleSave();
    },

    reorderUpcoming(uids) {
      set({ queue: reorderUpcoming(get().queue, uids) });
      scheduleSave();
    },

    clearUpcoming() {
      set({ queue: clearUpcoming(get().queue) });
      scheduleSave();
    },

    async startRadio(track) {
      set({ queue: loadQueue({ ...get().queue, shuffle: false, unshuffled: null }, [track], 0, { kind: "radio", label: `${track.title} Radio`, id: track.id }) });
      loadCurrent(true);
      const added = await extendWithRadio();
      if (added === 0) toast("Couldn't find similar songs right now", { kind: "error" });
    },

    setAutoplay(on) {
      set({ autoplay: on });
      scheduleSave();
    },

    setQueueOpen(open) {
      set({ queueOpen: open });
    },
  };
});

/** current song, or null */
export const useCurrentTrack = () => usePlayer((s) => currentItem(s.queue)?.track ?? null);

/** live audio levels for visuals; null until something has played */
export const getAnalyser = (): AnalyserNode | null => engine?.analyser ?? null;

// save the position every few seconds while playing, and on quit
setInterval(() => {
  if (usePlayer.getState().status === "playing") saveNow();
}, 5000);

window.addEventListener("beforeunload", () => {
  finishListening();
  saveNow();
});
