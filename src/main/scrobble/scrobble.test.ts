import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types";
import { scrobbleThreshold, shouldScrobble } from "@shared/scrobbleRules";
import { openDatabase } from "../db";
import { lastfmSignature, Lastfm, ListenBrainz } from "./clients";
import { Scrobbler, toScrobble } from "./scrobbler";

// a tiny stand-in for both services, recording what Vyse Music sends
interface Received {
  path: string;
  params: Record<string, string>;
  json?: Record<string, unknown>;
  auth?: string;
}
const received: Received[] = [];
let lbStatus = 200;
let lastfmSessionAfter = 0;
let lastfmScrobbleError: number | null = null;
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const params = Object.fromEntries(new URLSearchParams(req.method === "POST" && !url.pathname.startsWith("/lb") ? body : url.search));
      const json = url.pathname.startsWith("/lb") && body ? (JSON.parse(body) as Record<string, unknown>) : undefined;
      received.push({ path: url.pathname, params, json, auth: req.headers.authorization });
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === "/lb/1/validate-token") return send(200, req.headers.authorization === "Token good" ? { valid: true, user_name: "tester" } : { valid: false, message: "Invalid token" });
      if (url.pathname === "/lb/1/submit-listens") return send(lbStatus, lbStatus === 200 ? { status: "ok" } : { error: "down" });
      if (url.pathname === "/fm/") {
        if (params.method === "auth.getToken") return send(200, { token: "tok123" });
        if (params.method === "auth.getSession") {
          if (lastfmSessionAfter-- > 0) return send(403, { error: 14, message: "Unauthorized Token - This token has not been authorized" });
          return send(200, { session: { name: "tester-fm", key: "sk999" } });
        }
        if (params.method === "track.scrobble" && lastfmScrobbleError) return send(403, { error: lastfmScrobbleError, message: "Invalid session key" });
        return send(200, { ok: true });
      }
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const track: Track = {
  id: "youtube:J7p4bzqLvCw",
  source: "youtube",
  sourceId: "J7p4bzqLvCw",
  title: "Blinding Lights",
  artists: [{ name: "The Weeknd - Topic" }, { name: "Someone" }],
  album: { title: "After Hours" },
  durationMs: 200_000,
};

describe("scrobble rules", () => {
  it("counts after half the song or four minutes, never for very short songs", () => {
    expect(scrobbleThreshold(200_000)).toBe(100_000);
    expect(scrobbleThreshold(600_000)).toBe(240_000);
    expect(scrobbleThreshold(25_000)).toBeNull();
    expect(shouldScrobble(200_000, 99_000)).toBe(false);
    expect(shouldScrobble(200_000, 100_000)).toBe(true);
    expect(shouldScrobble(0, 240_000)).toBe(true);
  });

  it("signs Last.fm requests over the sorted parameters, leaving out format", () => {
    const sig = lastfmSignature({ method: "auth.getSession", token: "T", api_key: "K", format: "json" }, "S");
    expect(sig).toBe(createHash("md5").update("api_keyKmethodauth.getSessiontokenTS").digest("hex"));
  });

  it("describes a song the way the services want it", () => {
    expect(toScrobble(track, 1_700_000_000_500)).toEqual({
      artist: "The Weeknd",
      artists: "The Weeknd, Someone",
      track: "Blinding Lights",
      album: "After Hours",
      durationMs: 200_000,
      timestamp: 1_700_000_000,
      url: "https://music.youtube.com/watch?v=J7p4bzqLvCw",
    });
  });
});

describe("Scrobbler", () => {
  let db: DatabaseSync;
  let scrobbler: Scrobbler;
  let opened: string[];

  beforeEach(() => {
    received.length = 0;
    lbStatus = 200;
    lastfmSessionAfter = 0;
    lastfmScrobbleError = null;
    db = openDatabase(":memory:");
    opened = [];
    const vault = { encrypt: (s: string) => Buffer.from(s).toString("base64"), decrypt: (s: string) => Buffer.from(s, "base64").toString() };
    scrobbler = new Scrobbler(db, { lastfm: new Lastfm(`${base}/fm/`, `${base}/auth/`), listenbrainz: new ListenBrainz(`${base}/lb`) }, vault, (u) => opened.push(u), 10);
  });
  afterEach(() => {
    scrobbler.dispose();
    db.close();
  });

  it("connects to ListenBrainz with a token and sends listens", async () => {
    await expect(scrobbler.connectListenBrainz("bad")).rejects.toThrow("Invalid token");
    const status = await scrobbler.connectListenBrainz("good");
    expect(status.listenbrainz).toMatchObject({ connected: true, user: "tester" });

    scrobbler.played(track, 1_700_000_000_000);
    await scrobbler.flush();
    const sent = received.find((r) => r.path === "/lb/1/submit-listens");
    expect(sent?.auth).toBe("Token good");
    expect(sent?.json).toMatchObject({
      listen_type: "single",
      payload: [{ listened_at: 1_700_000_000, track_metadata: { artist_name: "The Weeknd, Someone", track_name: "Blinding Lights", release_name: "After Hours" } }],
    });
    expect(scrobbler.status().queued).toBe(0);
  });

  it("keeps listens queued while the service is down and sends them later", async () => {
    await scrobbler.connectListenBrainz("good");
    lbStatus = 503;
    scrobbler.played(track, 1_700_000_000_000);
    await scrobbler.flush();
    expect(scrobbler.status().queued).toBe(1);
    lbStatus = 200;
    db.prepare("UPDATE scrobble_queue SET next_try_at = ?").run(new Date(0).toISOString());
    await scrobbler.flush();
    expect(scrobbler.status().queued).toBe(0);
  });

  it("connects to Last.fm through the browser and scrobbles with a signed request", async () => {
    lastfmSessionAfter = 2;
    const status = await scrobbler.connectLastfm("KEY", "SECRET");
    expect(status.lastfm).toMatchObject({ pending: true, hasApiKey: true, connected: false });
    expect(opened).toEqual([`${base}/auth/?api_key=KEY&token=tok123`]);
    await vi.waitFor(() => expect(scrobbler.status().lastfm).toMatchObject({ connected: true, user: "tester-fm", pending: false }), { timeout: 2000 });

    scrobbler.played(track, 1_700_000_000_000);
    await scrobbler.flush();
    const sent = received.find((r) => r.params.method === "track.scrobble")!;
    expect(sent.params).toMatchObject({ "artist[0]": "The Weeknd", "track[0]": "Blinding Lights", "timestamp[0]": "1700000000", "album[0]": "After Hours", sk: "sk999", api_key: "KEY" });
    const { api_sig, format: _format, ...signed } = sent.params;
    expect(api_sig).toBe(lastfmSignature(signed, "SECRET"));
  });

  it("stops and says so when Last.fm rejects the session, keeping the listens", async () => {
    await scrobbler.connectLastfm("KEY", "SECRET");
    await vi.waitFor(() => expect(scrobbler.status().lastfm.connected).toBe(true), { timeout: 2000 });
    lastfmScrobbleError = 9;
    scrobbler.played(track, 1_700_000_000_000);
    await scrobbler.flush();
    expect(scrobbler.status().lastfm.error).toBe("Invalid session key");
    expect(scrobbler.status().queued).toBe(1);
  });

  it("does nothing when no service is connected, and forgets a service on disconnect", async () => {
    scrobbler.played(track, Date.now());
    expect(scrobbler.status().queued).toBe(0);
    await scrobbler.connectListenBrainz("good");
    lbStatus = 503;
    scrobbler.played(track, Date.now());
    await scrobbler.flush();
    expect(scrobbler.disconnect("listenbrainz")).toMatchObject({ listenbrainz: { connected: false }, queued: 0 });
  });

  it("stores credentials encrypted", async () => {
    await scrobbler.connectListenBrainz("good");
    const raw = (db.prepare("SELECT value FROM settings WHERE key = 'scrobble.credentials'").get() as { value: string }).value;
    expect(raw).not.toContain("good");
  });
});
