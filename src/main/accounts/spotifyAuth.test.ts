import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRefusedError, SignedOutError } from "./provider";
import { isClientId, SPOTIFY_SCOPES, SpotifySignIn, type SpotifyTokens } from "./spotifyAuth";

const CLIENT = "0123456789abcdef0123456789abcdef";
const ACCOUNTS = "https://accounts.test";

function memoryStore(initial: string | null = null) {
  let value = initial;
  return {
    get: () => value,
    set: (next: string | null) => {
      value = next;
    },
  };
}

interface TokenCall {
  form: URLSearchParams;
}

/** Spotify's token endpoint: answers each call with the next reply */
function tokenEndpoint(...replies: { status?: number; body: Record<string, unknown> }[]) {
  const calls: TokenCall[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    expect(url).toBe(`${ACCOUNTS}/api/token`);
    calls.push({ form: new URLSearchParams(init.body) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const granted = { body: { access_token: "a1", refresh_token: "r1", expires_in: 3600, token_type: "Bearer" } };

let open: SpotifySignIn[] = [];
afterEach(() => {
  for (const s of open) s.cancel();
  open = [];
});

/** a sign-in whose browser is this test: the page it would open is handed back */
function setup(options: { replies?: { status?: number; body: Record<string, unknown> }[]; clientId?: string | null; store?: ReturnType<typeof memoryStore> } = {}) {
  const store = options.store ?? memoryStore();
  const endpoint = tokenEndpoint(...(options.replies ?? [granted]));
  let resolvePage!: (url: URL) => void;
  const opened = new Promise<URL>((r) => (resolvePage = r));
  const pages: string[] = [];
  const signIn = new SpotifySignIn({
    store,
    clientId: () => (options.clientId === undefined ? CLIENT : options.clientId),
    openPage: (url) => {
      pages.push(url);
      resolvePage(new URL(url));
    },
    fetch: endpoint.fetchImpl,
    accountsUrl: ACCOUNTS,
  });
  open.push(signIn);
  return { signIn, store, endpoint, opened, pages };
}

/** what the browser does when Spotify sends it back */
async function comeBack(authorize: URL, params: Record<string, string>): Promise<{ status: number; text: string }> {
  const back = new URL(authorize.searchParams.get("redirect_uri")!);
  for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
  const res = await fetch(back);
  return { status: res.status, text: await res.text() };
}

describe("SpotifySignIn", () => {
  it("opens Spotify's page with PKCE, then swaps the code it gets back for a sign-in", async () => {
    const { signIn, store, endpoint, opened } = setup();
    const done = signIn.signIn();
    const page = await opened;

    expect(`${page.origin}${page.pathname}`).toBe(`${ACCOUNTS}/authorize`);
    const q = page.searchParams;
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("scope")).toBe(SPOTIFY_SCOPES.join(" "));
    expect(q.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(32);

    const browser = await comeBack(page, { code: "the-code", state: q.get("state")! });
    expect(browser.status).toBe(200);
    expect(browser.text).toContain("signed in to Spotify");
    expect(await done).toBe(true);

    // the code goes back with the verifier whose hash Spotify was shown, and no app secret
    const form = endpoint.calls[0].form;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("redirect_uri")).toBe(q.get("redirect_uri"));
    expect(form.get("client_id")).toBe(CLIENT);
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(q.get("code_challenge"));
    expect(form.has("client_secret")).toBe(false);

    const saved = JSON.parse(store.get()!) as SpotifyTokens;
    expect(saved).toMatchObject({ access_token: "a1", refresh_token: "r1", client_id: CLIENT });
    expect(await signIn.api.headers()).toEqual({ authorization: "Bearer a1" });
  });

  it("ignores a page with the wrong state, and still finishes with the right one", async () => {
    const { signIn, opened } = setup();
    const done = signIn.signIn();
    const page = await opened;
    const wrong = await comeBack(page, { code: "x", state: "someone-else" });
    expect(wrong.status).toBe(400);
    const right = await comeBack(page, { code: "x", state: page.searchParams.get("state")! });
    expect(right.status).toBe(200);
    expect(await done).toBe(true);
  });

  it("ends as not signed in when the person turns it down on Spotify's page", async () => {
    const { signIn, store, endpoint, opened } = setup();
    const done = signIn.signIn();
    const page = await opened;
    const browser = await comeBack(page, { error: "access_denied", state: page.searchParams.get("state")! });
    expect(browser.text).toContain("wasn't connected");
    expect(await done).toBe(false);
    expect(endpoint.calls).toHaveLength(0);
    expect(store.get()).toBeNull();
  });

  it("stops waiting when cancelled, and the page on this computer goes away", async () => {
    const { signIn, opened } = setup();
    const done = signIn.signIn();
    const page = await opened;
    signIn.cancel();
    expect(await done).toBe(false);
    await expect(fetch(page.searchParams.get("redirect_uri")!)).rejects.toThrow();
  });

  it("opens the same page again on request", async () => {
    const { signIn, opened, pages } = setup();
    const done = signIn.signIn();
    await opened;
    signIn.reopen();
    expect(pages).toHaveLength(2);
    expect(pages[1]).toBe(pages[0]);
    signIn.cancel();
    expect(await done).toBe(false);
  });

  it("says what to do when there's no Spotify app, or Spotify doesn't know it", async () => {
    await expect(setup({ clientId: null }).signIn.signIn()).rejects.toBeInstanceOf(AccountRefusedError);

    const { signIn, opened } = setup({ replies: [{ status: 400, body: { error: "invalid_client", error_description: "Invalid client" } }] });
    const refused = expect(signIn.signIn()).rejects.toThrow(/doesn't recognise this Spotify app/);
    const page = await opened;
    const browser = await comeBack(page, { code: "x", state: page.searchParams.get("state")! });
    expect(browser.status).toBe(502);
    await refused;
  });

  it("renews a sign-in that's running out, keeping a new refresh token, once for callers at the same time", async () => {
    const old: SpotifyTokens = { access_token: "a0", refresh_token: "r0", expires_at: new Date(Date.now() + 10_000).toISOString(), client_id: CLIENT };
    const store = memoryStore(JSON.stringify(old));
    const { signIn, endpoint } = setup({ store, replies: [{ body: { access_token: "a2", refresh_token: "r2", expires_in: 3600 } }] });
    const [one, two] = await Promise.all([signIn.api.headers(), signIn.api.headers()]);
    expect(one).toEqual({ authorization: "Bearer a2" });
    expect(two).toEqual(one);
    expect(endpoint.calls).toHaveLength(1);
    const form = endpoint.calls[0].form;
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("r0");
    expect(form.get("client_id")).toBe(CLIENT);
    expect(JSON.parse(store.get()!)).toMatchObject({ access_token: "a2", refresh_token: "r2" });
  });

  it("keeps the old refresh token when Spotify doesn't send a new one, and renews on request", async () => {
    const fresh: SpotifyTokens = { access_token: "a0", refresh_token: "r0", expires_at: new Date(Date.now() + 3_600_000).toISOString(), client_id: CLIENT };
    const store = memoryStore(JSON.stringify(fresh));
    const { signIn, endpoint } = setup({ store, replies: [{ body: { access_token: "a3", expires_in: 3600 } }] });
    expect(await signIn.api.headers()).toEqual({ authorization: "Bearer a0" });
    expect(endpoint.calls).toHaveLength(0);
    expect(await signIn.api.headers(true)).toEqual({ authorization: "Bearer a3" });
    expect(JSON.parse(store.get()!)).toMatchObject({ access_token: "a3", refresh_token: "r0" });
  });

  it("is signed out when there's no sign-in, or Spotify won't renew it", async () => {
    await expect(setup().signIn.api.headers()).rejects.toBeInstanceOf(SignedOutError);

    const old: SpotifyTokens = { access_token: "a0", refresh_token: "r0", expires_at: new Date(0).toISOString(), client_id: CLIENT };
    const { signIn } = setup({ store: memoryStore(JSON.stringify(old)), replies: [{ status: 400, body: { error: "invalid_grant", error_description: "Refresh token revoked" } }] });
    await expect(signIn.api.headers()).rejects.toBeInstanceOf(SignedOutError);
  });

  it("forgets the sign-in on sign out", async () => {
    const store = memoryStore(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: new Date(Date.now() + 3_600_000).toISOString(), client_id: CLIENT }));
    const { signIn } = setup({ store });
    await signIn.signOut();
    expect(store.get()).toBeNull();
  });

  it("knows a Client ID when it sees one", () => {
    expect(isClientId(CLIENT)).toBe(true);
    expect(isClientId(CLIENT.toUpperCase())).toBe(true);
    expect(isClientId("not-an-id")).toBe(false);
    expect(isClientId(`${CLIENT}0`)).toBe(false);
  });
});
