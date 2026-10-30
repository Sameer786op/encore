import { create } from "zustand";
import { joinRoom, selfId, type JsonValue, type Room } from "trystero";
import type { Track } from "@shared/types";
import { addFromJam, followHost, playbackClock, setJamAddedBy, setJamGuest, usePlayer, type JamGuestHooks } from "@/player/store";
import { currentItem, type QueueItem } from "@/player/queue";
import { toast } from "@/ui/toast";
import { findCode, makeCode } from "./code";
import {
  cleanAdd,
  cleanClock,
  cleanHello,
  cleanName,
  cleanPeople,
  cleanPing,
  cleanPong,
  cleanQueue,
  JAM_VERSION,
  MAX_ADD,
  shareQueue,
  shareTrack,
  type Clock,
  type Person,
  type SharedQueue,
} from "./protocol";
import { HostClock, positionAt } from "./timing";

// A Jam: friends listening together, each on their own computer. The host's
// Vyse Music leads; each guest's plays the same songs from YouTube Music
// itself and keeps to the same spot. Players find each other through public
// Nostr relays with the Jam's code, then talk directly over WebRTC, encrypted
// with a key made from the code. Only song details and timings are sent,
// never audio.

const APP_ID = "vyse-music-jam";
const NAME_KEY = "vyse.jam.name";
/** how long a guest looks for the host before giving up */
const FIND_HOST_MS = 30_000;
/** how long a guest waits for a host that dropped out to come back */
const RECONNECT_MS = 30_000;
/** the host says where it is this often, on top of every change */
const HEARTBEAT_MS = 2000;
/** a guest checks it's in time this often */
const FOLLOW_MS = 500;
/** a song file from the host's computer is played from YouTube Music when it's at least this sure it's the same song */
const SAME_SONG = 0.82;

export type JamStatus = "off" | "hosting" | "joining" | "joined" | "reconnecting";

interface JamStore {
  status: JamStatus;
  role: "host" | "guest" | null;
  code: string | null;
  /** your name in Jams, remembered */
  name: string;
  /** everyone in the Jam, the host first */
  people: Person[];
  hostName: string | null;
  error: string | null;
  start(name: string): void;
  join(code: string, name: string): void;
  /** the host ends the Jam for everyone; a guest leaves it */
  leave(): void;
}

interface Session {
  close(): void;
}

let session: Session | null = null;

/** this player's id in a Jam */
export const myJamId = selfId;

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // not remembered; it's asked again next time
  }
}

/** one kind of message: send it to everyone or one player, and hear it */
function channel(room: Room, name: string) {
  const action = room.makeAction<JsonValue>(name);
  return {
    send: (data: unknown, to?: string): Promise<void> => action.send(data as JsonValue, to ? { target: to } : undefined).catch(() => undefined),
    on(handler: (data: unknown, from: string) => void): void {
      action.onMessage = (data, { peerId }) => handler(data, peerId);
    },
  };
}

function openRoom(code: string) {
  // the code is both where to meet and the secret the meeting is encrypted with
  const room = joinRoom({ appId: APP_ID, password: code, maxReceiveBytes: 4 * 1024 * 1024 }, code.replace(/-/g, ""));
  return {
    room,
    hello: channel(room, "hello"),
    people: channel(room, "people"),
    queue: channel(room, "queue"),
    clock: channel(room, "clock"),
    ping: channel(room, "ping"),
    pong: channel(room, "pong"),
    add: channel(room, "add"),
    end: channel(room, "end"),
  };
}

/** your Jam: guests hear your queue and where you are in it, and can add songs */
function host(code: string, name: string): Session {
  const ch = openRoom(code);
  const me: Person = { id: selfId, name, host: true };
  const guests = new Map<string, Person>();
  const lastAdd = new Map<string, number>();
  let sent: Clock | null = null;
  let pending = { queue: false, clock: false };
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  setJamAddedBy(name);
  useJam.setState({ people: [me] });

  const publishPeople = () => {
    const everyone = [me, ...guests.values()];
    useJam.setState({ people: everyone });
    void ch.people.send(everyone);
  };
  const queueNow = (): SharedQueue => {
    const { queue } = usePlayer.getState();
    return shareQueue(queue.items, queue.index);
  };
  const clockNow = (): Clock => {
    const s = usePlayer.getState();
    const { position, rate, keepPitch } = playbackClock();
    return { uid: currentItem(s.queue)?.uid ?? null, position, playing: s.status === "playing", rate, keepPitch, at: Date.now() };
  };
  const sendClock = (to?: string) => {
    const clock = clockNow();
    if (!to) sent = clock;
    void ch.clock.send(clock, to);
  };
  // the queue goes before the clock that refers to it
  const flush = () => {
    if (pending.queue) void ch.queue.send(queueNow());
    if (pending.queue || pending.clock) sendClock();
    pending = { queue: false, clock: false };
  };
  const schedule = (what: "queue" | "clock") => {
    pending[what] = true;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 60);
  };

  ch.room.onPeerJoin = (peer) => void ch.hello.send({ v: JAM_VERSION, name, host: true }, peer);
  ch.room.onPeerLeave = (peer) => {
    if (guests.delete(peer)) publishPeople();
  };
  ch.hello.on((raw, peer) => {
    const hello = cleanHello(raw);
    if (!hello || hello.host) return;
    guests.set(peer, { id: peer, name: hello.name, host: false });
    publishPeople();
    void ch.queue.send(queueNow(), peer).then(() => sendClock(peer));
  });
  ch.ping.on((raw, peer) => {
    const ping = cleanPing(raw);
    if (ping) void ch.pong.send({ t: ping.t, host: Date.now() }, peer);
  });
  ch.add.on((raw, peer) => {
    const guest = guests.get(peer);
    const add = cleanAdd(raw);
    const now = Date.now();
    if (!guest || !add || now - (lastAdd.get(peer) ?? 0) < 300) return;
    lastAdd.set(peer, now);
    addFromJam(add.tracks, add.next, guest.name);
  });

  const unsubscribe = usePlayer.subscribe((s, before) => {
    if (s.queue.items !== before.queue.items || s.queue.index !== before.queue.index) schedule("queue");
    if (s.status !== before.status || currentItem(s.queue)?.uid !== currentItem(before.queue)?.uid) schedule("clock");
    // a jump in the song: a seek
    else if (sent && s.position !== before.position && Math.abs(s.position - positionAt(sent, Date.now())) > 0.75) schedule("clock");
  });
  const heartbeat = setInterval(() => sendClock(), HEARTBEAT_MS);
  const onUnload = () => void ch.end.send({});
  window.addEventListener("beforeunload", onUnload);

  return {
    close() {
      unsubscribe();
      clearInterval(heartbeat);
      clearTimeout(flushTimer);
      window.removeEventListener("beforeunload", onUnload);
      setJamAddedBy(null);
      void ch.end.send({}).finally(() => void ch.room.leave());
    },
  };
}

/** someone else's Jam: follow the host's player, and send songs for its queue */
function guest(code: string, name: string): Session {
  const ch = openRoom(code);
  const clock = new HostClock();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let hostId: string | null = null;
  let hostName = "The host";
  let queue: SharedQueue | null = null;
  let anchor: Clock | null = null;
  let hold = false;
  let followTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let lostTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRefusal = 0;
  // song files on the host's computer, as found on YouTube Music (null: not there)
  const matches = new Map<string, Track | null>();

  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  const findTimer = setTimeout(() => stop("Couldn't find that Jam. Check the code, and that the host still has Vyse Music open.", true), FIND_HOST_MS);

  const hooks: JamGuestHooks = {
    add(tracks, next) {
      const songs = tracks.filter((t) => t.source === "youtube").slice(0, MAX_ADD);
      if (songs.length === 0) {
        toast("Only songs from YouTube Music can go in a Jam, not song files from your computer.", { kind: "error" });
        return;
      }
      void ch.add.send({ tracks: songs.map(shareTrack), next }, hostId ?? undefined);
      toast(songs.length === 1 ? `Added "${songs[0].title}" to the Jam` : `Added ${songs.length} songs to the Jam`);
    },
    togglePlay() {
      hold = !hold;
      apply();
    },
    refuse() {
      if (Date.now() - lastRefusal < 3000) return;
      lastRefusal = Date.now();
      toast(`${hostName} chooses what plays in this Jam. You can add songs to it.`);
    },
  };

  /** a song file of the host's, as the YouTube Music song it matches once that's found */
  const resolve = (item: QueueItem): QueueItem => {
    if (item.track.source !== "local") return item;
    const found = matches.get(item.track.id);
    if (found) return { ...item, track: found };
    if (found === undefined) {
      matches.set(item.track.id, null);
      const { title, artists, album, durationMs } = item.track;
      void window.encore.imports
        .matchOne({ title, artists: artists.map((a) => a.name), album: album?.title, durationMs })
        .then(([best]) => {
          if (best && best.score >= SAME_SONG) {
            matches.set(item.track.id, best.track);
            apply();
          } else toast(`"${title}" is a song file on ${hostName}'s computer and isn't on YouTube Music, so it can't play here.`);
        })
        .catch(() => undefined);
    }
    return item;
  };

  function apply(): void {
    if (!queue || !anchor || !clock.ready || useJam.getState().status !== "joined") return;
    const uid = anchor.uid ?? queue.current;
    const items = queue.items.map(resolve);
    const index = uid ? items.findIndex((i) => i.uid === uid) : -1;
    // a song the queue on its way will have
    if (uid && index < 0) return;
    const silent = items[index]?.track.source === "local";
    followHost({
      items,
      index,
      context: { kind: "jam", label: `${hostName}'s Jam` },
      position: positionAt(anchor, clock.now()),
      playing: anchor.playing && !hold && !silent,
      rate: anchor.rate,
      keepPitch: anchor.keepPitch,
      silent,
    });
  }

  const ping = () => hostId && void ch.ping.send({ t: Date.now() }, hostId);

  function stop(message: string, failed = false): void {
    clearTimeout(findTimer);
    clearTimeout(lostTimer);
    clearInterval(followTimer);
    clearInterval(pingTimer);
    timers.forEach(clearTimeout);
    setJamGuest(null);
    if (hostId) followHost(null);
    void ch.room.leave();
    if (session === me) session = null;
    useJam.setState({ status: "off", role: null, code: null, people: [], hostName: null, error: failed ? message : null });
    if (!failed) toast(message);
  }

  ch.room.onPeerJoin = (peer) => void ch.hello.send({ v: JAM_VERSION, name, host: false }, peer);
  ch.room.onPeerLeave = (peer) => {
    if (peer !== hostId || useJam.getState().status !== "joined") return;
    useJam.setState({ status: "reconnecting" });
    lostTimer = setTimeout(() => stop(`Lost the connection to ${hostName}'s Jam.`), RECONNECT_MS);
  };
  ch.hello.on((raw, peer) => {
    const hello = cleanHello(raw);
    if (!hello?.host || (hostId && hostId !== peer && useJam.getState().status === "joined")) return;
    const first = !hostId;
    hostId = peer;
    hostName = hello.name;
    clearTimeout(findTimer);
    clearTimeout(lostTimer);
    useJam.setState({ status: "joined", hostName });
    if (!first) return;
    setJamGuest(hooks);
    // a few quick pings to learn the host's clock, then now and then to keep it right
    for (let i = 0; i < 5; i++) later(ping, i * 250);
    pingTimer = setInterval(ping, 5000);
    followTimer = setInterval(apply, FOLLOW_MS);
    toast(`You joined ${hostName}'s Jam`);
  });
  const fromHost = (peer: string) => peer === hostId;
  ch.queue.on((raw, peer) => {
    const shared = fromHost(peer) && cleanQueue(raw);
    if (!shared) return;
    queue = shared;
    apply();
  });
  ch.clock.on((raw, peer) => {
    const said = fromHost(peer) && cleanClock(raw);
    if (!said) return;
    anchor = said;
    apply();
  });
  ch.people.on((raw, peer) => fromHost(peer) && useJam.setState({ people: cleanPeople(raw) }));
  ch.pong.on((raw, peer) => {
    const pong = fromHost(peer) && cleanPong(raw);
    if (!pong) return;
    clock.add(pong.t, pong.host, Date.now());
    apply();
  });
  ch.end.on((_, peer) => fromHost(peer) && stop(`${hostName} ended the Jam`));

  const me: Session = { close: () => stop("You left the Jam") };
  return me;
}

export const useJam = create<JamStore>((set, get) => ({
  status: "off",
  role: null,
  code: null,
  name: savedName(),
  people: [],
  hostName: null,
  error: null,

  start(raw) {
    session?.close();
    const name = cleanName(raw);
    rememberName(name);
    const code = makeCode();
    set({ status: "hosting", role: "host", code, name, hostName: name, error: null });
    session = host(code, name);
  },

  join(text, raw) {
    const code = findCode(text);
    if (!code) {
      set({ error: "That isn't a Jam code. It looks like K7QM-P3XR-9TWD." });
      return;
    }
    session?.close();
    const name = cleanName(raw);
    rememberName(name);
    set({ status: "joining", role: "guest", code, name, people: [], hostName: null, error: null });
    session = guest(code, name);
  },

  leave() {
    const current = session;
    session = null;
    current?.close();
    if (get().role === "host") toast("You ended the Jam");
    set({ status: "off", role: null, code: null, people: [], hostName: null });
  },
}));
