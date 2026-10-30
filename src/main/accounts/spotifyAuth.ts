import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { SecretStore } from "./google";
import type { ApiAuth } from "./http";
import { AccountRefusedError, SignedOutError, type AccountAuth } from "./provider";

// Spotify connects through its official sign-in, in the person's own browser:
// Vyse Music opens Spotify's page, they sign in there (or already are) and click
// Agree, and Spotify sends the browser back to a page Vyse Music serves on this
// computer only (127.0.0.1) with a one-time code. That code, with a secret only
// this sign-in knows (PKCE), is swapped for the sign-in. No password passes
// through Vyse Music, and there's no app secret to keep.
//
// Spotify lets an app like this read only the accounts added by email in its
// developer dashboard (5 at most), and only while the app's owner has Premium.

export const SPOTIFY_SCOPES = ["playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-follow-read"];
/** what to register in the Spotify app; Spotify adds the port each sign-in picks */
export const SPOTIFY_REDIRECT = "http://127.0.0.1/callback";

const ACCOUNTS = "https://accounts.spotify.com";
/** how long a sign-in waits for the browser to come back */
const WAIT_MS = 15 * 60_000;

/** what's kept between runs; the store encrypts it */
export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  /** when the access token runs out */
  expires_at: string;
  /** the Spotify app that signed in; the sign-in can only be renewed by the same one */
  client_id: string;
}

/** a Spotify app's Client ID: 32 hex digits */
export function isClientId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

/** a code verifier and its S256 challenge (RFC 7636) */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export class SpotifySignIn implements AccountAuth {
  private waiting: { url?: string; stop(): void } | null = null;
  private renewing: Promise<SpotifyTokens> | null = null;

  constructor(
    private readonly options: {
      store: SecretStore;
      /** the Spotify app to sign in with (the person's own, or the one built in), or null when there's neither */
      clientId(): string | null;
      /** show Spotify's page in the person's browser */
      openPage(url: string): void;
      fetch?: typeof fetch;
      /** a stand-in for accounts.spotify.com, for tests */
      accountsUrl?: string;
    },
  ) {}

  private get accounts(): string {
    return this.options.accountsUrl ?? ACCOUNTS;
  }

  /** open Spotify's page in the browser, then wait for it to send the browser back; true once signed in */
  signIn(): Promise<boolean> {
    this.cancel();
    const clientId = this.options.clientId();
    if (!clientId) {
      return Promise.reject(new AccountRefusedError("Connecting Spotify needs a Spotify app. Add its Client ID under Use your own Spotify app, below."));
    }
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(24).toString("base64url");

    return new Promise<boolean>((resolve, reject) => {
      let redirect = "";
      let busy = false;
      let settled = false;
      const server = createServer((req, res) => {
        void answer(req, res).catch(() => undefined);
      });
      const finish = (outcome: boolean | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        if (this.waiting === waiting) this.waiting = null;
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      };
      const waiting: { url?: string; stop(): void } = { stop: () => finish(false) };
      this.waiting = waiting;
      const timer = setTimeout(() => finish(false), WAIT_MS);

      const answer = async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method !== "GET" || url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        // only the page this sign-in opened can finish it
        if (url.searchParams.get("state") !== state || settled || busy) {
          page(res, 400, "This sign-in link has run out", "Start again in Vyse Music: Settings → Accounts → Spotify → Connect.");
          return;
        }
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        if (error || !code) {
          page(res, 200, "Spotify wasn't connected", "You can close this tab. To connect later, go to Settings → Accounts in Vyse Music.");
          finish(false);
          return;
        }
        busy = true;
        try {
          const tokens = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }, clientId);
          if (settled) return;
          this.options.store.set(JSON.stringify(tokens));
          page(res, 200, "You're signed in to Spotify", "You can close this tab and go back to Vyse Music. Your playlists are on their way.", true);
          finish(true);
        } catch (failure) {
          page(res, 502, "Spotify couldn't finish signing in", "Go back to Vyse Music to see what happened, then try connecting again.");
          finish(failure instanceof Error ? failure : new Error(String(failure)));
        }
      };

      server.on("error", (error) => finish(error));
      server.listen(0, "127.0.0.1", () => {
        if (settled) return;
        redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
        const params = new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: redirect,
          code_challenge_method: "S256",
          code_challenge: challenge,
          state,
          scope: SPOTIFY_SCOPES.join(" "),
          // lets someone signed in to Spotify in the browser pick a different account
          show_dialog: "true",
        });
        waiting.url = `${this.accounts}/authorize?${params}`;
        this.options.openPage(waiting.url);
      });
    });
  }

  /** ask Spotify's token endpoint; a refused code or sign-in comes back as the error the person can act on */
  private async exchange(form: Record<string, string>, clientId: string, previous?: SpotifyTokens): Promise<SpotifyTokens> {
    const res = await (this.options.fetch ?? fetch)(`${this.accounts}/api/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 400 || res.status === 401) {
      if (body.error === "invalid_client") throw new AccountRefusedError("Spotify doesn't recognise this Spotify app. Check its Client ID under Use your own Spotify app, below.");
      // a renewal that's turned down: the access was removed at spotify.com, or it ran out
      if (previous) throw new SignedOutError(`Spotify no longer takes the sign-in (${String(body.error)})`);
      throw new Error(`Spotify turned the sign-in down (${String(body.error_description ?? body.error ?? res.status)})`);
    }
    if (!res.ok || typeof body.access_token !== "string") throw new Error(`accounts.spotify.com answered ${res.status}`);
    const refresh = typeof body.refresh_token === "string" ? body.refresh_token : previous?.refresh_token;
    if (!refresh) throw new Error("Spotify sent no refresh token");
    return {
      access_token: body.access_token,
      refresh_token: refresh,
      expires_at: new Date(Date.now() + Number(body.expires_in ?? 3_600) * 1_000).toISOString(),
      client_id: clientId,
    };
  }

  private saved(): SpotifyTokens | null {
    const raw = this.options.store.get();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SpotifyTokens;
    } catch {
      return null;
    }
  }

  /** the sign-in, renewed first when it's about to run out (or `fresh` asks) */
  private async tokens(fresh?: boolean): Promise<SpotifyTokens> {
    const saved = this.saved();
    if (!saved) throw new SignedOutError("Not signed in to Spotify");
    if (!fresh && Date.parse(saved.expires_at) - Date.now() > 60_000) return saved;
    if (!this.renewing) {
      this.renewing = this.renew(saved).finally(() => {
        this.renewing = null;
      });
    }
    return this.renewing;
  }

  private async renew(saved: SpotifyTokens): Promise<SpotifyTokens> {
    const tokens = await this.exchange({ grant_type: "refresh_token", refresh_token: saved.refresh_token, client_id: saved.client_id }, saved.client_id, saved);
    // Spotify may hand out a new refresh token, and the old one stops working; keep it, unless this sign-in was replaced or removed meanwhile
    if (this.saved()?.refresh_token === saved.refresh_token) this.options.store.set(JSON.stringify(tokens));
    return tokens;
  }

  /** sign-in headers for Spotify's Web API */
  readonly api: ApiAuth = {
    headers: async (fresh) => ({ authorization: `Bearer ${(await this.tokens(fresh)).access_token}` }),
  };

  cancel(): void {
    this.waiting?.stop();
  }

  reopen(): void {
    if (this.waiting?.url) this.options.openPage(this.waiting.url);
  }

  /** forget the sign-in on this computer; the person can also remove Vyse Music at spotify.com/account/apps */
  async signOut(): Promise<void> {
    this.cancel();
    this.options.store.set(null);
  }
}

/** the page the browser lands on after Spotify; it never loads anything else */
function page(res: ServerResponse, status: number, title: string, body: string, ok = false): void {
  const mark = ok
    ? `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#1ed760" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`
    : `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#a7a7ad" stroke-width="2.5" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>`;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "referrer-policy": "no-referrer",
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Vyse Music</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#3a1420,#0b0b0d 60%);color:#f5f5f7;font:15px/1.55 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
main{width:min(440px,calc(100vw - 32px));padding:36px 32px;border-radius:28px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px rgba(0,0,0,.45);text-align:center;animation:rise .6s cubic-bezier(.32,.72,0,1)}
.mark{width:56px;height:56px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.07)}
h1{margin:0 0 8px;font-size:21px;font-weight:600;letter-spacing:-.01em}
p{margin:0;color:#a7a7ad}
.brand{margin-top:22px;font-size:12px;color:#6e6e73;letter-spacing:.02em}
@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.98)}}
@media (prefers-reduced-motion:reduce){main{animation:none}}
</style></head><body><main><div class="mark">${mark}</div><h1>${title}</h1><p>${body}</p><div class="brand">Vyse Music</div></main></body></html>`);
}
