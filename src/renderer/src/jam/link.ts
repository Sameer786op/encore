import { createEvent, joinRoom, selfId, subscribe, type JsonValue } from "trystero";

// How Jam players reach each other. They meet through Trystero: public Nostr
// relays to find each other, then WebRTC straight between the computers. Many
// home and mobile networks share one public address between customers behind a
// "symmetric" NAT, and between two of those the direct connection never opens.
// Then messages go through a few big public Nostr relays instead, sealed with a
// key made from the Jam's code, so the relays only ever see noise. Each message
// still reaches the other player once, and in the order it was sent.

/** relays for messages between players who can't connect directly */
export const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://nostr.mom"];
/** how long two players try to connect directly before talking through the relays */
const DIRECT_WAIT_MS = 6000;
/** each player says it's here this often, through the relays */
const PRESENCE_MS = 4000;
/** a player not connected directly and not heard from through the relays for this long has gone */
const GONE_MS = 15_000;
/** a relayed message that arrives ahead of an earlier one waits this long for it */
const REORDER_MS = 800;
const MAX_HELD = 200;
/** sealed messages bigger than this are refused */
const MAX_SEALED = 256 * 1024;
/** messages waiting for a relay to connect, and for how long */
const MAX_WAITING = 50;
const WAIT_MS = 10_000;
/** for testing the relays: never connect directly */
const RELAY_ONLY_KEY = "vyse.jam.relayOnly";

export interface Channel {
  /** to everyone in the Jam, some players, or one */
  send(data: unknown, to?: string | string[]): Promise<void>;
  on(handler: (data: unknown, from: string) => void): void;
}

export interface Link {
  onPeerJoin: (peer: string) => void;
  onPeerLeave: (peer: string) => void;
  channel(name: string): Channel;
  /** connected to at least one relay, so other players can be found */
  reachable(): boolean;
  leave(): void;
}

/** what goes through the relays, inside the seal */
export interface Envelope {
  /** the sender, and which of their links: a new one each time they join */
  f: string;
  l: string;
  /** counts up with each message from that link, to put them back in order and drop copies */
  s: number;
  /** a player saying it's here or gone, or else a message on a channel */
  p?: "here" | "gone";
  c?: string;
  d?: unknown;
  /** who it's for; everyone when missing */
  t?: string[];
}

const ID = /^[\w-]{1,64}$/;
const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

/** an envelope from another player, checked; null if it isn't one */
export function cleanEnvelope(value: unknown): Envelope | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (!isId(e.f) || !isId(e.l) || !Number.isSafeInteger(e.s) || (e.s as number) < 0) return null;
  const envelope: Envelope = { f: e.f, l: e.l, s: e.s as number };
  if (e.p === "here" || e.p === "gone") envelope.p = e.p;
  else if (typeof e.c === "string" && /^[a-z]{1,12}$/.test(e.c)) {
    envelope.c = e.c;
    envelope.d = e.d;
  } else return null;
  if (e.t !== undefined) {
    if (!Array.isArray(e.t) || e.t.length > 64 || !e.t.every(isId)) return null;
    envelope.t = e.t as string[];
  }
  return envelope;
}

/** puts each player's relayed messages back in the order they were sent, once each */
export class Ordering {
  private streams = new Map<string, { next: number | null; held: Map<number, Envelope>; timer?: ReturnType<typeof setTimeout>; seen: number }>();

  constructor(
    private deliver: (envelope: Envelope) => void,
    private waitMs = REORDER_MS,
  ) {}

  add(envelope: Envelope, now = Date.now()): void {
    const key = `${envelope.f}/${envelope.l}`;
    let stream = this.streams.get(key);
    if (!stream) this.streams.set(key, (stream = { next: null, held: new Map(), seen: now }));
    stream.seen = now;
    if ((stream.next !== null && envelope.s < stream.next) || stream.held.has(envelope.s)) return;
    stream.held.set(envelope.s, envelope);
    this.drain(stream);
    if (stream.held.size > MAX_HELD) this.skip(stream);
    // a new stream waits a moment too, in case its first message is still on the way
    else if (stream.held.size && !stream.timer) stream.timer = setTimeout(() => this.skip(stream), this.waitMs);
  }

  /** forget players not heard from for a while */
  prune(olderThan: number): void {
    for (const [key, stream] of this.streams) {
      if (stream.seen < olderThan && stream.held.size === 0) this.streams.delete(key);
    }
  }

  clear(): void {
    this.streams.forEach((stream) => clearTimeout(stream.timer));
    this.streams.clear();
  }

  private drain(stream: { next: number | null; held: Map<number, Envelope>; timer?: ReturnType<typeof setTimeout> }): void {
    if (stream.next === null) return;
    while (stream.held.has(stream.next)) {
      const envelope = stream.held.get(stream.next)!;
      stream.held.delete(stream.next);
      stream.next++;
      this.deliver(envelope);
    }
    if (stream.held.size === 0) {
      clearTimeout(stream.timer);
      stream.timer = undefined;
    }
  }

  /** stop waiting for what's missing: carry on from the earliest message that did arrive */
  private skip(stream: { next: number | null; held: Map<number, Envelope>; timer?: ReturnType<typeof setTimeout> }): void {
    clearTimeout(stream.timer);
    stream.timer = undefined;
    if (stream.held.size === 0) return;
    stream.next = Math.min(...stream.held.keys());
    this.drain(stream);
    if (stream.held.size) stream.timer = setTimeout(() => this.skip(stream), this.waitMs);
  }
}

const text = new TextEncoder();

/** the key a Jam's relayed messages are sealed with, made slowly from its code so it can't be guessed quickly */
export async function relayKey(code: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", text.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: text.encode("vyse-music-jam relay"), iterations: 100_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** where a Jam's relayed messages meet: says nothing about the code */
export async function relayTopic(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", text.encode(`vyse-music-jam relay topic ${code}`)));
  return [...digest.slice(0, 20)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function squeeze(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** an envelope, squeezed and sealed */
export async function seal(key: CryptoKey, envelope: Envelope): Promise<string> {
  const plain = await squeeze(text.encode(JSON.stringify(envelope)), new CompressionStream("deflate-raw"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64(out);
}

/** what was sealed, or null for anything sealed with another key, or not sealed at all */
export async function unseal(key: CryptoKey, sealed: string): Promise<unknown> {
  if (sealed.length > MAX_SEALED) return null;
  try {
    const bytes = fromBase64(sealed);
    if (bytes.length < 13) return null;
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
    return JSON.parse(new TextDecoder().decode(await squeeze(plain, new DecompressionStream("deflate-raw"))));
  } catch {
    return null;
  }
}

function relayOnly(): boolean {
  try {
    return localStorage.getItem(RELAY_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

/** the relays for one Jam: sends sealed events to all of them, and hears the Jam's from any */
function relaySockets(urls: string[], topic: string, onEvent: (content: string) => void) {
  const subId = `vyse${Math.random().toString(36).slice(2, 12)}`;
  const sockets = new Map<string, WebSocket | null>();
  const waiting: { event: string; at: number }[] = [];
  // each relay passes on the same event: open it once
  const heard = new Set<string>();
  let closed = false;

  const openSockets = () => [...sockets.values()].filter((ws): ws is WebSocket => ws?.readyState === WebSocket.OPEN);
  const flush = () => {
    const now = Date.now();
    const ready = openSockets();
    if (ready.length === 0) return;
    for (const { event, at } of waiting.splice(0)) if (now - at < WAIT_MS) ready.forEach((ws) => ws.send(event));
  };
  const connect = (url: string, retryMs: number) => {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setTimeout(() => connect(url, Math.min(retryMs * 2, 30_000)), retryMs);
      return;
    }
    sockets.set(url, ws);
    ws.onopen = () => {
      retryMs = 2000;
      ws.send(subscribe(subId, topic));
      flush();
    };
    ws.onmessage = (message) => {
      try {
        const [type, sub, event] = JSON.parse(String(message.data));
        if (type !== "EVENT" || sub !== subId || typeof event?.content !== "string" || typeof event.id !== "string" || heard.has(event.id)) return;
        heard.add(event.id);
        if (heard.size > 1000) heard.delete(heard.values().next().value!);
        onEvent(event.content);
      } catch {
        // not something we asked for
      }
    };
    ws.onclose = () => {
      if (sockets.get(url) === ws) sockets.set(url, null);
      if (!closed) setTimeout(() => connect(url, Math.min(retryMs * 2, 30_000)), retryMs);
    };
  };
  urls.forEach((url) => connect(url, 2000));

  return {
    send(event: string): void {
      const ready = openSockets();
      if (ready.length) ready.forEach((ws) => ws.send(event));
      else if (waiting.push({ event, at: Date.now() }) > MAX_WAITING) waiting.shift();
    },
    reachable: () => openSockets().length > 0,
    close(): void {
      closed = true;
      sockets.forEach((ws) => ws?.close());
    },
  };
}

interface Peer {
  /** connected straight to this computer */
  direct: boolean;
  /** talking through the relays instead */
  relayed: boolean;
  /** last heard from through the relays */
  seen: number;
  /** which time they joined, as heard through the relays: each leave and join again is a new one */
  link?: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** join a Jam's players, directly where the network allows and through the relays where it doesn't */
export function openLink(appId: string, code: string): Link {
  const peers = new Map<string, Peer>();
  const handlers = new Map<string, (data: unknown, from: string) => void>();
  const linkId = Math.random().toString(36).slice(2, 12);
  let seq = 0;
  let left = false;
  // relayed messages go out one at a time, so they leave in the order they were sent
  let outgoing: Promise<unknown> = Promise.resolve();

  const joined = (p: Peer | undefined) => !!p && (p.direct || p.relayed);
  const peer = (id: string) => {
    let p = peers.get(id);
    if (!p) peers.set(id, (p = { direct: false, relayed: false, seen: 0 }));
    return p;
  };

  const link: Link = {
    onPeerJoin: () => undefined,
    onPeerLeave: () => undefined,
    channel,
    reachable: () => relays.reachable(),
    leave,
  };

  /** start talking to a player through the relays, if they're there */
  const viaRelays = (id: string) => {
    const p = peers.get(id);
    if (!p || left) return;
    clearTimeout(p.timer);
    p.timer = undefined;
    if (joined(p) || !p.seen) return;
    p.relayed = true;
    link.onPeerJoin(id);
  };
  const forget = (id: string) => {
    const p = peers.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    peers.delete(id);
    if (joined(p)) link.onPeerLeave(id);
  };

  // ---- directly ----
  const room = joinRoom(
    { appId, password: code, maxReceiveBytes: 4 * 1024 * 1024, ...(relayOnly() ? { rtcConfig: { iceServers: [], iceTransportPolicy: "relay" as const } } : {}) },
    // the code is both where to meet and the secret the meeting is encrypted with
    code.replace(/-/g, ""),
    // the two computers swapped how to reach each other, but the connection didn't open
    { onJoinError: ({ peerId }) => viaRelays(peerId) },
  );
  room.onPeerJoin = (id) => {
    if (left) return;
    const p = peer(id);
    clearTimeout(p.timer);
    p.timer = undefined;
    const was = joined(p);
    p.direct = true;
    if (!was) link.onPeerJoin(id);
  };
  room.onPeerLeave = (id) => {
    const p = peers.get(id);
    if (!p || left) return;
    p.direct = false;
    // still heard through the relays: carry on that way
    if (Date.now() - p.seen < GONE_MS) p.relayed = true;
    else forget(id);
  };

  // ---- through the relays ----
  const keys = Promise.all([relayKey(code), relayTopic(code)]);
  let relays: ReturnType<typeof relaySockets> = { send: () => undefined, reachable: () => false, close: () => undefined };
  const ordering = new Ordering((envelope) => {
    if (left) return;
    const id = envelope.f;
    const p = peer(id);
    if (envelope.p === "gone") {
      // a goodbye from a time before they joined again is out of date
      if (!p.direct && (!p.link || p.link === envelope.l)) forget(id);
      return;
    }
    if (p.link !== envelope.l) {
      // they left and joined again, and the goodbye got lost: the time before is over
      if (p.link && p.relayed && !p.direct) {
        p.relayed = false;
        link.onPeerLeave(id);
        if (!p.timer) p.timer = setTimeout(() => viaRelays(id), DIRECT_WAIT_MS);
      }
      p.link = envelope.l;
    }
    if (!envelope.c || (envelope.t && !envelope.t.includes(selfId))) return;
    // a message from a player not joined yet: join them first, as a direct connection opens before anything comes through it
    if (!joined(p)) {
      p.seen = Date.now();
      viaRelays(id);
    }
    handlers.get(envelope.c)?.(envelope.d, id);
  });
  const hear = async (content: string) => {
    const [key] = await keys;
    const envelope = cleanEnvelope(await unseal(key, content));
    if (!envelope || envelope.f === selfId || left) return;
    // anything from a player says they're here; give a direct connection a moment first
    const p = peer(envelope.f);
    p.seen = Date.now();
    if (envelope.p !== "gone" && !joined(p) && !p.timer) p.timer = setTimeout(() => viaRelays(envelope.f), DIRECT_WAIT_MS);
    ordering.add(envelope);
  };
  void keys.then(([, topic]) => {
    if (!left) relays = relaySockets(RELAYS, topic, (content) => void hear(content));
  });
  const relay = (message: Omit<Envelope, "f" | "l" | "s">): Promise<unknown> => {
    const envelope: Envelope = { f: selfId, l: linkId, s: seq++, ...message };
    outgoing = outgoing
      .then(() => keys)
      .then(async ([key, topic]) => relays.send(await createEvent(topic, await seal(key, envelope))))
      .catch(() => undefined);
    return outgoing;
  };

  const presence = setInterval(() => void relay({ p: "here" }), PRESENCE_MS);
  void relay({ p: "here" });
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, p] of peers) if (!p.direct && p.seen && now - p.seen > GONE_MS) forget(id);
    ordering.prune(now - 60_000);
  }, 2000);

  function channel(name: string): Channel {
    const action = room.makeAction<JsonValue>(name);
    action.onMessage = (data, { peerId }) => handlers.get(name)?.(data, peerId);
    return {
      send(data, to) {
        const targets = to === undefined ? [...peers.keys()].filter((id) => joined(peers.get(id))) : Array.isArray(to) ? to : [to];
        const direct = targets.filter((id) => peers.get(id)?.direct);
        const relayed = targets.filter((id) => !peers.get(id)?.direct);
        const sent: Promise<unknown>[] = [];
        if (direct.length) sent.push(action.send(data as JsonValue, { target: direct }).catch(() => undefined));
        if (relayed.length) sent.push(relay({ c: name, d: data, t: relayed }));
        return Promise.all(sent).then(() => undefined);
      },
      on(handler) {
        handlers.set(name, handler);
      },
    };
  }

  function leave(): void {
    if (left) return;
    left = true;
    clearInterval(presence);
    clearInterval(sweep);
    peers.forEach((p) => clearTimeout(p.timer));
    ordering.clear();
    // say goodbye through the relays, then hang up
    void relay({ p: "gone" }).finally(() => setTimeout(() => relays.close(), 500));
    void room.leave();
  }

  return link;
}
