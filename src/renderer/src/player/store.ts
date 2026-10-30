import { create } from "zustand";
import { scrobbleThreshold } from "@shared/scrobbleRules";
import type { Track } from "@shared/types";
import { useLibrary } from "@/library/store";
import { useSettings } from "@/settings/store";
import { toast } from "@/ui/toast";
import type { Command } from "@/jam/protocol";
import { correction } from "@/jam/timing";
import { AudioEngine } from "./engine";
import { fadeLength, levellingDb, shouldCrossfade, shouldPreload } from "./transitions";
import {
  addToJam,
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
  type QueueItem,
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

// In a Jam, a guest's player follows the host's: its own presses go through
// these instead, and the host's songs come in through followHost.
export interface JamGuestHooks {
  /** songs for the host's queue */
  add(tracks: Track[], next: boolean): void;
  /** pause or carry on: for everyone when the host lets guests change what plays, otherwise for this guest only */
  togglePlay(): void;
  /** a press that changes what plays for everyone: sent to the host if it lets guests, refused if not */
  control(command: Command): void;
  /** a press only the host can make */
  refuse(): void;
}

/** where a Jam guest's player should be: the host's queue, and where its song is right now */
export interface HostPlayback {
  items: QueueItem[];
  index: number;
  context: PlayContext;
  position: number;
  playing: boolean;
  rate: number;
  keepPitch: boolean;
  /** the song can't play here: a song file on the host's computer that isn't on YouTube Music */
  silent: boolean;
}

let jamGuest: JamGuestHooks | null = null;
let following = false;
let followImpl: ((host: HostPlayback | null) => void) | null = null;
/** while hosting a Jam, the name songs you add are put down to */
let jamAddedBy: string | null = null;

export function setJamGuest(hooks: JamGuestHooks | null): void {
  jamGuest = hooks;
}

export function setJamAddedBy(name: string | null): void {
  jamAddedBy = name;
}

/** a Jam guest's player goes where the host's is; null stops following and pauses */
export function followHost(host: HostPlayback | null): void {
  followImpl?.(host);
}

/** while hosting, a guest's songs go into the queue under their name */
export function addFromJam(tracks: Track[], next: boolean, by: string): void {
  const own = jamAddedBy;
  jamAddedBy = by;
  try {
    if (next) usePlayer.getState().playNext(tracks);
    else usePlayer.getState().addToQueue(tracks);
  } finally {
    jamAddedBy = own;
  }
}

/** where the song is to the millisecond, how fast it plays, and whether it keeps its key */
export function playbackClock(): { position: number; rate: number; keepPitch: boolean } {
  if (!engine?.currentTrack) return { position: usePlayer.getState().position, rate: 1, keepPitch: true };
  return { position: engine.currentTime, rate: engine.speed, keepPitch: engine.keepsPitch };
}

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
  /** music was playing when this was saved, so it carries on when the app opens */
  playing: boolean;
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
let savedPlaying = false;
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
  savedPlaying = s.status === "playing" || s.status === "loading";
  const saved: SavedPlayer = { queue, position: s.position, playing: savedPlaying, volume: s.volume, muted: s.muted, autoplay: s.autoplay };
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
        // in real seconds: a sped-up song reaches its end sooner
        const remaining = (duration - seconds) / getEngine().speed;
        const settings = useSettings.getState();
        let next = upcomingAuto();

        // the queue is about to run out: find similar songs early so the handover is smooth
        if (!next && current && !following && get().autoplay && shouldPreload(remaining, settings.crossfadeSeconds) && radioAskedFor !== current.uid) {
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

        // a Jam guest moves on when the host does
        if (following) return;
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
      onEnded: () => !following && void advance(true),
      onFailed(track) {
        if (following) {
          toast(`Couldn't play "${track.title}" here`, { kind: "error" });
          return;
        }
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
    engine.setPure(settings.pureSound);
    engine.setEq(settings.eq);
    engine.setLevelling(settings.levelling);
    engine.setSpeed(settings.sound.speed, settings.sound.keepPitch);
    engine.setReverb(settings.sound.reverb);
    useSettings.subscribe((s, before) => {
      if (s.pureSound !== before.pureSound) engine?.setPure(s.pureSound);
      if (s.eq !== before.eq) engine?.setEq(s.eq);
      if (s.levelling !== before.levelling) engine?.setLevelling(s.levelling);
      if (s.sound !== before.sound) {
        engine?.setSpeed(s.sound.speed, s.sound.keepPitch);
        engine?.setReverb(s.sound.reverb);
      }
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

  followImpl = (host) => {
    const e = getEngine();
    if (!host) {
      following = false;
      e.follow(null);
      if (!e.isPaused) e.pause();
      return;
    }
    following = true;
    const before = currentItem(get().queue);
    set({ queue: { items: host.items, index: host.index, shuffle: false, repeat: "off", unshuffled: null, context: host.context } });
    const item = currentItem(get().queue);
    const speed = { rate: host.rate, keepPitch: host.keepPitch };
    if (!item) {
      e.follow({ ...speed, nudge: 1 });
      if (e.currentTrack) loadCurrent(false);
      return;
    }
    if (host.silent) {
      if (e.currentTrack) {
        startListening(null);
        e.unload();
      }
      set({ status: "paused", position: host.position, duration: item.track.durationMs / 1000 });
      return;
    }
    if (before?.uid !== item.uid || e.currentTrack?.id !== item.track.id) {
      e.follow({ ...speed, nudge: 1 });
      loadCurrent(host.playing, host.position);
      return;
    }
    // the same song: line it up once it has loaded
    if (get().status === "loading") return;
    if (!host.playing) {
      e.follow({ ...speed, nudge: 1 });
      if (!e.isPaused) e.pause();
      if (Math.abs(host.position - e.currentTime) > 0.25) moveTo(host.position);
      return;
    }
    if (e.isPaused) {
      e.follow({ ...speed, nudge: 1 });
      moveTo(host.position);
      e.play();
      return;
    }
    const fix = correction(host.position, e.currentTime);
    e.follow({ ...speed, nudge: fix.kind === "nudge" ? fix.rate : 1 });
    if (fix.kind === "seek") moveTo(fix.to);
  };

  function moveTo(seconds: number): void {
    listening.lastPosition = seconds;
    getEngine().seek(seconds);
    set({ position: seconds });
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
      if (jamGuest) return jamGuest.add([tracks[Math.min(Math.max(0, startIndex), tracks.length - 1)]], false);
      set({ queue: loadQueue(get().queue, tracks, startIndex, context) });
      loadCurrent(true);
    },

    togglePlay() {
      if (jamGuest) return jamGuest.togglePlay();
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

    next: () => (jamGuest ? jamGuest.control({ do: "next" }) : void advance(false)),

    previous() {
      if (jamGuest) return jamGuest.control({ do: "previous" });
      const { position, queue } = get();
      if (position > 3 || (queue.index <= 0 && queue.repeat === "off")) {
        get().seek(0);
        return;
      }
      set({ queue: setIndex(queue, previousIndex(queue)) });
      loadCurrent(true);
    },

    seek(seconds) {
      if (jamGuest) return jamGuest.control({ do: "seek", uid: currentItem(get().queue)?.uid ?? "", to: Math.max(0, seconds) });
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
      if (jamGuest) return jamGuest.refuse();
      set({ queue: setShuffle(get().queue, !get().queue.shuffle) });
      scheduleSave();
    },

    cycleRepeat() {
      if (jamGuest) return jamGuest.refuse();
      set({ queue: { ...get().queue, repeat: cycleRepeat(get().queue.repeat) } });
      scheduleSave();
    },

    playNext(tracks) {
      if (jamGuest) return jamGuest.add(tracks, true);
      const wasEmpty = get().queue.index < 0;
      set({ queue: playNext(get().queue, tracks, jamAddedBy ?? undefined) });
      if (wasEmpty) loadCurrent(true);
      scheduleSave();
    },

    addToQueue(tracks) {
      if (jamGuest) return jamGuest.add(tracks, false);
      const wasEmpty = get().queue.index < 0;
      // while hosting a Jam, added songs take their turn ahead of the rest of the queue
      set({ queue: jamAddedBy ? addToJam(get().queue, tracks, jamAddedBy) : addToQueue(get().queue, tracks) });
      if (wasEmpty) loadCurrent(true);
      scheduleSave();
    },

    jumpTo(uid) {
      if (jamGuest) return jamGuest.control({ do: "jump", uid });
      set({ queue: jumpTo(get().queue, uid) });
      loadCurrent(true);
    },

    removeFromQueue(uid) {
      if (jamGuest) return jamGuest.control({ do: "remove", uid });
      const { state, removedCurrent } = removeItem(get().queue, uid);
      set({ queue: state });
      if (removedCurrent) loadCurrent(get().status === "playing" || get().status === "loading");
      scheduleSave();
    },

    reorderUpcoming(uids) {
      if (jamGuest) return jamGuest.control({ do: "move", uids });
      set({ queue: reorderUpcoming(get().queue, uids) });
      scheduleSave();
    },

    clearUpcoming() {
      if (jamGuest) return jamGuest.refuse();
      set({ queue: clearUpcoming(get().queue) });
      scheduleSave();
    },

    async startRadio(track) {
      if (jamGuest) return jamGuest.refuse();
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

// save the position every few seconds while playing (and once after it stops), and on quit
setInterval(() => {
  if (usePlayer.getState().status === "playing" || savedPlaying) saveNow();
}, 5000);

// carry on where you left off: music that was playing when the app closed continues from the same spot
if (saved.playing && currentItem(usePlayer.getState().queue) && useSettings.getState().continueOnOpen) {
  setTimeout(() => usePlayer.getState().status === "paused" && usePlayer.getState().togglePlay(), 300);
}

window.addEventListener("beforeunload", () => {
  finishListening();
  saveNow();
});
