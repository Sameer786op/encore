import { createHash } from "node:crypto";

// Thin clients for the two scrobbling services. Base URLs can be pointed at a
// local test server through environment variables.

export interface Scrobble {
  artist: string;
  /** every credited artist, for services that keep them all */
  artists: string;
  track: string;
  album?: string;
  durationMs?: number;
  /** unix seconds when the song started */
  timestamp: number;
  url?: string;
}

/** the service said no for good (bad key or token): retrying won't help */
export class AuthError extends Error {
  constructor(
    message: string,
    /** Last.fm's error code, when there is one */
    readonly code?: number,
  ) {
    super(message);
  }
}
/** worth trying again later */
export class TemporaryError extends Error {}

const APP = { name: "Vyse Music", version: "0.1.0" };
const TIMEOUT_MS = 15_000;

// ---- ListenBrainz ----

export class ListenBrainz {
  constructor(private readonly base = process.env.ENCORE_LISTENBRAINZ_URL ?? "https://api.listenbrainz.org") {}

  async validate(token: string): Promise<string> {
    const res = await fetch(`${this.base}/1/validate-token`, { headers: { authorization: `Token ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as { valid?: boolean; user_name?: string; message?: string };
    if (!res.ok || !body.valid || !body.user_name) throw new AuthError(body.message ?? "That token wasn't accepted");
    return body.user_name;
  }

  static payload(s: Scrobble, withTime: boolean): Record<string, unknown> {
    return {
      ...(withTime ? { listened_at: s.timestamp } : {}),
      track_metadata: {
        artist_name: s.artists || s.artist,
        track_name: s.track,
        ...(s.album ? { release_name: s.album } : {}),
        additional_info: {
          ...(s.durationMs ? { duration_ms: s.durationMs } : {}),
          ...(s.url ? { origin_url: s.url, music_service: "music.youtube.com" } : {}),
          media_player: APP.name,
          submission_client: APP.name,
          submission_client_version: APP.version,
        },
      },
    };
  }

  async submit(token: string, kind: "single" | "import" | "playing_now", scrobbles: Scrobble[]): Promise<void> {
    const res = await fetch(`${this.base}/1/submit-listens`, {
      method: "POST",
      headers: { authorization: `Token ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ listen_type: kind, payload: scrobbles.map((s) => ListenBrainz.payload(s, kind !== "playing_now")) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return;
    const message = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `ListenBrainz answered ${res.status}`;
    if (res.status === 401) throw new AuthError(message);
    if (res.status === 429 || res.status >= 500) throw new TemporaryError(message);
    // anything else is a problem with these listens; don't retry them forever
    throw new Error(message);
  }
}

// ---- Last.fm ----

/** Last.fm signs requests with md5 of the sorted parameters followed by the secret */
export function lastfmSignature(params: Record<string, string>, secret: string): string {
  const text =
    Object.keys(params)
      .filter((k) => k !== "format" && k !== "callback")
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join("") + secret;
  return createHash("md5").update(text, "utf8").digest("hex");
}

export interface LastfmKeys {
  apiKey: string;
  secret: string;
}

/** Last.fm error codes that mean the key or session is no good */
const AUTH_CODES = new Set([4, 9, 10, 14, 15, 26]);
const RETRY_CODES = new Set([8, 11, 16, 29]);

export class Lastfm {
  constructor(
    private readonly base = process.env.ENCORE_LASTFM_URL ?? "https://ws.audioscrobbler.com/2.0/",
    private readonly authBase = process.env.ENCORE_LASTFM_AUTH_URL ?? "https://www.last.fm/api/auth/",
  ) {}

  private async call(method: string, params: Record<string, string>, keys: LastfmKeys, post = false): Promise<Record<string, unknown>> {
    const all: Record<string, string> = { ...params, method, api_key: keys.apiKey };
    all.api_sig = lastfmSignature(all, keys.secret);
    all.format = "json";
    const body = new URLSearchParams(all);
    const res = await fetch(post ? this.base : `${this.base}?${body}`, {
      method: post ? "POST" : "GET",
      ...(post ? { body, headers: { "content-type": "application/x-www-form-urlencoded" } } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof json.error === "number") {
      const message = String(json.message ?? "Last.fm said no");
      if (AUTH_CODES.has(json.error)) throw new AuthError(message, json.error);
      if (RETRY_CODES.has(json.error)) throw new TemporaryError(message);
      throw new Error(message);
    }
    if (!res.ok) throw new TemporaryError(`Last.fm answered ${res.status}`);
    return json;
  }

  async getToken(keys: LastfmKeys): Promise<string> {
    const json = await this.call("auth.getToken", {}, keys);
    if (typeof json.token !== "string") throw new Error("Last.fm didn't give a token");
    return json.token;
  }

  authUrl(keys: LastfmKeys, token: string): string {
    return `${this.authBase}?api_key=${encodeURIComponent(keys.apiKey)}&token=${encodeURIComponent(token)}`;
  }

  /** fails with code 14 until the user has approved the token in the browser */
  async getSession(keys: LastfmKeys, token: string): Promise<{ name: string; key: string }> {
    const json = await this.call("auth.getSession", { token }, keys);
    const session = json.session as { name?: string; key?: string } | undefined;
    if (!session?.key || !session.name) throw new Error("Last.fm didn't give a session");
    return { name: session.name, key: session.key };
  }

  async nowPlaying(keys: LastfmKeys, sessionKey: string, s: Scrobble): Promise<void> {
    await this.call(
      "track.updateNowPlaying",
      { artist: s.artist, track: s.track, ...(s.album ? { album: s.album } : {}), ...(s.durationMs ? { duration: String(Math.round(s.durationMs / 1000)) } : {}), sk: sessionKey },
      keys,
      true,
    );
  }

  async scrobble(keys: LastfmKeys, sessionKey: string, scrobbles: Scrobble[]): Promise<void> {
    const params: Record<string, string> = { sk: sessionKey };
    scrobbles.slice(0, 50).forEach((s, i) => {
      params[`artist[${i}]`] = s.artist;
      params[`track[${i}]`] = s.track;
      params[`timestamp[${i}]`] = String(s.timestamp);
      if (s.album) params[`album[${i}]`] = s.album;
      if (s.durationMs) params[`duration[${i}]`] = String(Math.round(s.durationMs / 1000));
    });
    await this.call("track.scrobble", params, keys, true);
  }
}
