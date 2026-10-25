import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Innertube } from "youtubei.js";
import { GoogleSignIn, type GoogleTokens } from "./google";
import { SignedOutError, type SignInCode } from "./provider";

const CLIENT = { client_id: "tv-client", client_secret: "tv-secret" };

/** what youtubei.js offers for Google's TV sign-in, without the network */
function fakeYouTube(signIn: (tokens: GoogleTokens) => Promise<void> = async () => undefined) {
  return {
    session: {
      oauth: {
        client_id: undefined as unknown,
        getClientID: async () => CLIENT,
        getDeviceAndUserCode: async () => ({ device_code: "device-1", user_code: "ABC-DEF-GHIJ", verification_url: "https://www.google.com/device", expires_in: 1800, interval: 5 }),
      },
      on: () => undefined,
      signIn: vi.fn(signIn),
    },
  };
}

/** Google's token answers, one per poll; the last one repeats */
function tokenServer(...answers: Record<string, unknown>[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(answers.length > 1 ? answers.shift() : answers[0]));
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, bodies };
}

function memoryStore(value: string | null = null) {
  const store = { value, get: () => store.value, set: (v: string | null) => void (store.value = v) };
  return store;
}

describe("GoogleSignIn", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the code, opens Google's page, and keeps the sign-in once it's approved there", async () => {
    const store = memoryStore();
    const opened: SignInCode[] = [];
    const shown: SignInCode[] = [];
    const server = tokenServer({ error: "authorization_pending" }, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 });
    const google = new GoogleSignIn({ store, openPage: (c) => opened.push(c), fetch: server.fetch, create: async () => fakeYouTube() as unknown as Innertube });

    const signingIn = google.signIn((c) => shown.push(c));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(shown).toEqual([{ code: "ABC-DEF-GHIJ", url: "https://www.google.com/device" }]);
    expect(opened).toEqual(shown);
    expect(store.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await signingIn).toBe(true);

    expect(server.bodies[0]).toEqual({ ...CLIENT, code: "device-1", grant_type: "http://oauth.net/grant_type/device/1.0" });
    const saved = JSON.parse(store.value!) as GoogleTokens;
    expect(saved).toMatchObject({ access_token: "access-1", refresh_token: "refresh-1", client: CLIENT });
    expect(Date.parse(saved.expiry_date)).toBeGreaterThan(Date.now());
  });

  it("ends as not signed in when it's turned down on Google's page", async () => {
    const store = memoryStore();
    const google = new GoogleSignIn({ store, openPage: () => undefined, fetch: tokenServer({ error: "access_denied" }).fetch, create: async () => fakeYouTube() as unknown as Innertube });
    const signingIn = google.signIn();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await signingIn).toBe(false);
    expect(store.value).toBeNull();
  });

  it("stops waiting straight away on Cancel, and can open the page again before that", async () => {
    const opened: SignInCode[] = [];
    const server = tokenServer({ error: "authorization_pending" });
    const google = new GoogleSignIn({ store: memoryStore(), openPage: (c) => opened.push(c), fetch: server.fetch, create: async () => fakeYouTube() as unknown as Innertube });
    const signingIn = google.signIn();
    await vi.advanceTimersByTimeAsync(5_000);
    google.reopen();
    expect(opened).toHaveLength(2);
    google.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(await signingIn).toBe(false);
    const polls = server.bodies.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.bodies.length).toBe(polls);
  });

  it("reads with the saved sign-in, and is signed out without one or once Google refuses it", async () => {
    await expect(new GoogleSignIn({ store: memoryStore(), openPage: () => undefined }).client()).rejects.toBeInstanceOf(SignedOutError);

    const tokens: GoogleTokens = { access_token: "a", refresh_token: "r", expiry_date: new Date(Date.now() + 60_000).toISOString(), client: CLIENT };
    const yt = fakeYouTube();
    const create = vi.fn(async () => yt as unknown as Innertube);
    const google = new GoogleSignIn({ store: memoryStore(JSON.stringify(tokens)), openPage: () => undefined, create });
    expect(await google.client()).toBe(yt);
    expect(await google.client()).toBe(yt);
    expect(create).toHaveBeenCalledTimes(1);
    expect(yt.session.signIn).toHaveBeenCalledWith(tokens);

    const refusing = fakeYouTube(async () => {
      throw new Error("Failed to refresh access token: 400");
    });
    const removed = new GoogleSignIn({ store: memoryStore(JSON.stringify(tokens)), openPage: () => undefined, create: async () => refusing as unknown as Innertube });
    await expect(removed.client()).rejects.toBeInstanceOf(SignedOutError);
  });

  it("forgets the sign-in on this computer when signing out", async () => {
    const store = memoryStore(JSON.stringify({ access_token: "a", refresh_token: "r", expiry_date: new Date().toISOString(), client: CLIENT }));
    const google = new GoogleSignIn({ store, openPage: () => undefined });
    await google.signOut();
    expect(store.value).toBeNull();
    await expect(google.client()).rejects.toBeInstanceOf(SignedOutError);
  });
});
