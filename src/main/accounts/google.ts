import { Innertube } from "youtubei.js";
import { SignedOutError, sleep, type AccountAuth, type SignInCode } from "./provider";

// YouTube Music connects through Google's own "sign in on a TV" page, opened in
// the person's own browser, where they're usually signed in to Google already:
// Vyse Music shows a short code, they enter it at google.com/device and pick
// their account. No password passes through Vyse Music. YouTube accepts this
// sign-in only from its TV app, so youtube.ts reads the library the way a TV does.

const TOKEN_URL = "https://www.youtube.com/o/oauth2/token";
const DEVICE_GRANT = "http://oauth.net/grant_type/device/1.0";

interface ClientId {
  client_id: string;
  client_secret: string;
}

/** what's kept between runs; the store encrypts it */
export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: string;
  client: ClientId;
}

export interface SecretStore {
  get(): string | null;
  set(value: string | null): void;
}

/** Google no longer takes the sign-in: it was removed from the Google account, or the password changed */
export function refused(error: unknown): boolean {
  return /Failed to refresh access token: 4\d\d|status code 401\b/.test(String((error as Error)?.message));
}

export class GoogleSignIn implements AccountAuth {
  private session: Promise<Innertube> | null = null;
  private waiting: { stop(): void; code?: SignInCode } | null = null;

  constructor(
    private readonly options: {
      store: SecretStore;
      /** show Google's page in the person's browser, with the code ready to paste */
      openPage(code: SignInCode): void;
      fetch?: typeof fetch;
      create?: () => Promise<Innertube>;
    },
  ) {}

  private create(): Promise<Innertube> {
    return this.options.create?.() ?? Innertube.create({ retrieve_player: false });
  }

  /** ask Google for a code, open its page, then wait for the person to approve it there */
  async signIn(showCode?: (code: SignInCode) => void): Promise<boolean> {
    this.cancel();
    let stopped = false;
    let wake!: () => void;
    const stoppedEarly = new Promise<void>((resolve) => (wake = resolve));
    const waiting: { stop(): void; code?: SignInCode } = {
      stop: () => {
        stopped = true;
        wake();
      },
    };
    this.waiting = waiting;
    try {
      const yt = await this.create();
      const oauth = yt.session.oauth;
      const client = (await oauth.getClientID()) as ClientId;
      oauth.client_id = client;
      const device = await oauth.getDeviceAndUserCode();
      if (stopped) return false;
      waiting.code = { code: device.user_code, url: device.verification_url };
      showCode?.(waiting.code);
      this.options.openPage(waiting.code);

      let interval = Math.max(device.interval, 1) * 1_000;
      const until = Date.now() + device.expires_in * 1_000;
      while (Date.now() < until) {
        await Promise.race([sleep(interval), stoppedEarly]);
        if (stopped) return false;
        const answer = (await (this.options.fetch ?? fetch)(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...client, code: device.device_code, grant_type: DEVICE_GRANT }),
        })
          .then((r) => r.json())
          // a dropped connection: ask again next time round
          .catch(() => null)) as Record<string, unknown> | null;
        if (stopped) return false;
        if (!answer || answer.error === "authorization_pending") continue;
        if (answer.error === "slow_down") {
          interval += 5_000;
          continue;
        }
        // turned down on Google's page, or the code ran out
        if (answer.error || typeof answer.refresh_token !== "string" || typeof answer.access_token !== "string") return false;
        const tokens: GoogleTokens = {
          access_token: answer.access_token,
          refresh_token: answer.refresh_token,
          expiry_date: new Date(Date.now() + Number(answer.expires_in ?? 3_600) * 1_000).toISOString(),
          client,
        };
        this.options.store.set(JSON.stringify(tokens));
        this.session = null;
        return true;
      }
      return false;
    } finally {
      if (this.waiting === waiting) this.waiting = null;
    }
  }

  cancel(): void {
    this.waiting?.stop();
  }

  reopen(): void {
    if (this.waiting?.code) this.options.openPage(this.waiting.code);
  }

  /**
   * Forgets the sign-in on this computer. It isn't revoked at Google: Google
   * sees it as its own TV app's sign-in, and revoking that could sign the
   * person's actual TV out too. It shows as "YouTube on TV" in their Google
   * account, where they can remove it themselves.
   */
  async signOut(): Promise<void> {
    this.cancel();
    this.session = null;
    this.options.store.set(null);
  }

  /** a YouTube session signed in with the saved sign-in; throws SignedOutError without one, or once Google stops taking it */
  readonly client = (): Promise<Innertube> => {
    if (this.session) return this.session;
    const saved = this.options.store.get();
    if (!saved) return Promise.reject(new SignedOutError("Not signed in to YouTube"));
    const tokens = JSON.parse(saved) as GoogleTokens;
    const session: Promise<Innertube> = (async () => {
      const yt = await this.create();
      // Google hands out a fresh access token every hour; keeping it saves asking again on the next start
      yt.session.on("update-credentials", ({ credentials }) => {
        if (credentials && this.session === session) this.options.store.set(JSON.stringify({ ...credentials, client: tokens.client }));
      });
      try {
        await yt.session.signIn({ ...tokens });
      } catch (error) {
        throw refused(error) ? new SignedOutError("Google no longer takes the sign-in") : error;
      }
      return yt;
    })();
    this.session = session;
    session.catch(() => {
      if (this.session === session) this.session = null;
    });
    return session;
  };
}
