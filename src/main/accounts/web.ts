import { BrowserWindow, session, type Session } from "electron";
import type { AccountService } from "@shared/types";
import { ACCOUNT_NAMES } from "@shared/types";
import type { ApiAuth } from "./http";
import { SignedOutError, sleep, type AccountAuth } from "./provider";

// Signing in to Apple Music happens on its own pages, in a window with its own
// browser storage; Vyse Music never sees the password. Later, a hidden window
// opens the web app now and then: that keeps the sign-in fresh the way a browser
// tab would, and the app's own API calls carry the token Vyse Music then reads
// with. (Spotify and YouTube Music sign in through the person's own browser
// instead: see spotifyAuth.ts and google.ts.)

const MAJOR = process.versions.chrome.split(".")[0];
// some sign-in pages turn away browsers they don't recognise, so these windows present themselves as Chrome
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36`;
const CHROME_BRANDS = `"Google Chrome";v="${MAJOR}", "Chromium";v="${MAJOR}", "Not_A Brand";v="24"`;

interface Site {
  signIn: string;
  /** the web app a hidden window opens to refresh the sign-in */
  app: string;
  /** a cookie that's only there while signed in */
  signedIn: { url: string; name: string };
  /** API requests whose headers carry the token, and the headers to keep from them */
  token?: { url: RegExp; headers: string[] };
  /** how long a token or cookie set picked up from the web app is used before opening it again */
  keepMs: number;
}

export type WebService = Exclude<AccountService, "youtube" | "spotify">;

const SITES: Record<WebService, Site> = {
  apple: {
    // the Sign In button is at the top of the page
    signIn: "https://music.apple.com/",
    app: "https://music.apple.com/",
    signedIn: { url: "https://music.apple.com", name: "media-user-token" },
    token: { url: /^https:\/\/amp-api(-edge)?\.music\.apple\.com\//, headers: ["authorization", "media-user-token"] },
    keepMs: 12 * 60 * 60_000,
  },
};

const SECURE: Electron.WebPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false };

export class AccountWeb {
  private sessions = new Map<WebService, Session>();
  // the latest token headers the service's own pages sent
  private seen = new Map<WebService, Record<string, string>>();
  private held = new Map<WebService, { headers: Record<string, string>; at: number }>();
  private refreshing = new Map<WebService, Promise<void>>();
  private signIns = new Map<WebService, { win: BrowserWindow; done: Promise<boolean> }>();
  private windows = new Set<BrowserWindow>();
  private disposed = false;

  constructor(private readonly options: { parent: () => BrowserWindow | null; icon: string }) {}

  private session(service: WebService): Session {
    const existing = this.sessions.get(service);
    if (existing) return existing;
    const ses = session.fromPartition(`persist:account-${service}`);
    ses.setUserAgent(CHROME_UA, "en-US,en");
    // sign-in pages may ask to keep their cookies across their own sites; camera, notifications and the like aren't needed here
    const allowed = new Set(["storage-access", "top-level-storage-access", "clipboard-sanitized-write", "fullscreen"]);
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
    const token = SITES[service].token;
    ses.webRequest.onBeforeSendHeaders({ urls: ["https://*/*"] }, (details, callback) => {
      const headers = details.requestHeaders;
      for (const key of Object.keys(headers)) if (key.toLowerCase() === "sec-ch-ua") headers[key] = CHROME_BRANDS;
      if (token?.url.test(details.url)) {
        const picked: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) if (token.headers.includes(key.toLowerCase()) && value) picked[key.toLowerCase()] = value;
        if (Object.keys(picked).length > 0) this.seen.set(service, { ...this.seen.get(service), ...picked });
      }
      callback({ requestHeaders: headers });
    });
    this.sessions.set(service, ses);
    return ses;
  }

  private async cookie(service: WebService, name: string): Promise<string | undefined> {
    const site = SITES[service];
    const cookies = await this.session(service).cookies.get({ url: site.signedIn.url, name });
    return cookies.find((c) => c.value)?.value;
  }

  private async signedIn(service: WebService): Promise<boolean> {
    if (await this.cookie(service, SITES[service].signedIn.name)) return true;
    // Apple may keep its token only in the page; seeing it sent counts too
    return service === "apple" && !!this.seen.get(service)?.["media-user-token"];
  }

  auth(service: WebService): AccountAuth {
    return {
      signIn: () => this.signIn(service),
      signOut: () => this.signOut(service),
      // closing the window ends the sign-in as not signed in
      cancel: () => this.signIns.get(service)?.win.close(),
      reopen: () => this.signIns.get(service)?.win.focus(),
    };
  }

  /** a window on the service's sign-in page; resolves true once signed in, false if closed first */
  signIn(service: WebService): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const open = this.signIns.get(service);
    if (open && !open.win.isDestroyed()) {
      open.win.focus();
      return open.done;
    }
    const ses = this.session(service);
    const win = new BrowserWindow({
      parent: this.options.parent() ?? undefined,
      width: 520,
      height: 760,
      minWidth: 420,
      minHeight: 560,
      title: `Sign in to ${ACCOUNT_NAMES[service]} · Vyse Music`,
      icon: this.options.icon,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: { ...SECURE, session: ses },
    });
    win.setMenu(null);
    // keep our title, so it's always clear what this window is for
    win.on("page-title-updated", (event) => event.preventDefault());
    // "Continue with Google" and the like open small windows of their own; they share this sign-in
    win.webContents.setWindowOpenHandler(({ url }) =>
      url.startsWith("https://")
        ? { action: "allow", overrideBrowserWindowOptions: { parent: win, width: 500, height: 700, autoHideMenuBar: true, webPreferences: { ...SECURE, session: ses } } }
        : { action: "deny" },
    );
    win.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("https://")) event.preventDefault();
    });

    const done = new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished) return;
        finished = true;
        clearInterval(poll);
        this.signIns.delete(service);
        if (!win.isDestroyed()) win.destroy();
        resolve(ok);
      };
      const poll = setInterval(() => {
        void this.signedIn(service).then(async (ok) => {
          if (!ok || finished) return;
          // let the page finish setting its cookies before the window goes
          await sleep(1_500);
          finish(true);
        });
      }, 1_000);
      win.on("closed", () => void this.signedIn(service).then(finish, () => finish(false)));
    });
    this.signIns.set(service, { win, done });
    void win.loadURL(SITES[service].signIn).catch(() => undefined);
    return done;
  }

  async signOut(service: WebService): Promise<void> {
    this.held.delete(service);
    this.seen.delete(service);
    const ses = this.session(service);
    await ses.clearStorageData();
    await ses.clearCache();
  }

  /** open the service's web app out of sight, so it refreshes its own sign-in and shows its token */
  private refresh(service: WebService): Promise<void> {
    const running = this.refreshing.get(service);
    if (running) return running;
    const run = this.openHidden(service).finally(() => this.refreshing.delete(service));
    this.refreshing.set(service, run);
    return run;
  }

  private async openHidden(service: WebService): Promise<void> {
    if (this.disposed) throw new Error("Closing");
    const site = SITES[service];
    this.seen.delete(service);
    const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { ...SECURE, session: this.session(service), backgroundThrottling: false } });
    this.windows.add(win);
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
      await Promise.race([win.loadURL(site.app).catch(() => undefined), sleep(45_000)]);
      // the token turns up with the app's first API calls
      const until = Date.now() + 25_000;
      while (site.token && Date.now() < until && !(await this.tokenHeaders(service))) await sleep(400);
      // a moment for refreshed cookies to be stored
      await sleep(1_500);
    } finally {
      this.windows.delete(win);
      if (!win.isDestroyed()) win.destroy();
    }
  }

  /** the headers an API call needs, from what the web app sent */
  private async tokenHeaders(service: WebService): Promise<Record<string, string> | null> {
    const seen = this.seen.get(service) ?? {};
    if (service === "apple") {
      const user = seen["media-user-token"] ?? (await this.cookie(service, "media-user-token"));
      if (!seen.authorization || !user) return null;
      // Apple's web token only works from its own site
      return { authorization: seen.authorization, "media-user-token": user, origin: "https://music.apple.com", referer: "https://music.apple.com/", "user-agent": CHROME_UA };
    }
    return null;
  }

  /** sign-in headers for Apple's API */
  apiAuth(service: WebService): ApiAuth {
    return {
      headers: async (fresh) => {
        const held = this.held.get(service);
        if (!fresh && held && Date.now() - held.at < SITES[service].keepMs) return held.headers;
        if (!(await this.signedIn(service))) throw new SignedOutError(`Not signed in to ${service}`);
        await this.refresh(service);
        const headers = await this.tokenHeaders(service);
        if (!headers) throw new SignedOutError(`No ${service} token`);
        this.held.set(service, { headers, at: Date.now() });
        return headers;
      },
    };
  }

  /** close every window this opened; the app is closing */
  dispose(): void {
    this.disposed = true;
    for (const { win } of this.signIns.values()) if (!win.isDestroyed()) win.destroy();
    for (const win of this.windows) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
  }
}
