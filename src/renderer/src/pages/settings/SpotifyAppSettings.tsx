import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Copy, ExternalLink } from "lucide-react";
import type { SpotifyAppInfo } from "@shared/types";
import { toast } from "@/ui/toast";
import { cn } from "@/lib/cn";

// Spotify signs in through a Spotify app made in its developer dashboard. A copy
// of Vyse Music can come with one built in; anyone can use their own instead.

const CLIENT_ID = /^[0-9a-f]{32}$/i;

export interface SpotifyApp {
  info: SpotifyAppInfo | null;
  save(clientId: string | null): Promise<void>;
}

/** the Spotify app that Spotify sign-ins go through */
export function useSpotifyApp(): SpotifyApp {
  const [info, setInfo] = useState<SpotifyAppInfo | null>(null);
  useEffect(() => {
    let live = true;
    void window.encore.accounts.spotifyApp().then((found) => live && setInfo(found));
    return () => {
      live = false;
    };
  }, []);
  return {
    info,
    save: async (clientId) => setInfo(await window.encore.accounts.setSpotifyApp(clientId)),
  };
}

/** there's no Spotify app to sign in with yet */
export function needsSpotifyApp(app: SpotifyApp | undefined): boolean {
  return !!app?.info && !app.info.builtIn && !app.info.own;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-ink hover:underline">
      {children} <ExternalLink className="size-3" />
    </a>
  );
}

const pill = "glass-control pressable inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium hover:brightness-125 disabled:opacity-50";

/** how to use your own Spotify app, and where its Client ID goes */
export function SpotifyAppSetup({ app }: { app: SpotifyApp }) {
  const info = app.info!;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(info.own ?? "");
  const [saving, setSaving] = useState(false);
  const clean = draft.trim().toLowerCase();
  const valid = CLIENT_ID.test(clean);
  const changed = clean !== (info.own ?? "");

  const save = async (clientId: string | null) => {
    setSaving(true);
    try {
      await app.save(clientId);
      setDraft(clientId ?? "");
      toast(clientId ? "Spotify will use your own app from the next sign-in." : info.builtIn ? "Spotify will use the built-in app again." : "Your Spotify app was removed.");
    } finally {
      setSaving(false);
    }
  };
  const copyRedirect = () =>
    void navigator.clipboard.writeText(info.redirectUri).then(
      () => toast("Redirect URI copied"),
      () => undefined,
    );

  return (
    <div className="ml-14">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="pressable -ml-2 mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-white/[0.06] hover:text-ink"
      >
        {info.own ? "Using your own Spotify app" : info.builtIn ? "Use your own Spotify app" : "Have Spotify Premium? Connect through your own Spotify app"}
        <ChevronDown className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-[14px] bg-white/[0.05] px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-2">
              <p>
                Spotify lets an app like Vyse Music read only the Spotify accounts added by email in its developer dashboard, up to 5, and only while the app's owner has Spotify
                Premium.{" "}
                {info.builtIn
                  ? "This copy comes with a Spotify app, and whoever set it up adds the people who connect. To use your own instead:"
                  : "If you have Premium, you can make a Spotify app of your own and connect through it:"}
              </p>
              <ol className="mt-2.5 space-y-2">
                <Step n={1}>
                  Signed in with {info.builtIn ? "a" : "your"} Premium account, create an app at{" "}
                  <Link href="https://developer.spotify.com/dashboard">developer.spotify.com/dashboard</Link>.
                </Step>
                <Step n={2}>
                  <span>Tick Web API, and add this Redirect URI:</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code aria-label="Redirect URI" className="select-all rounded-[8px] bg-white/[0.07] px-2 py-1 font-mono text-[12px] text-ink">
                      {info.redirectUri}
                    </code>
                    <button onClick={copyRedirect} className={cn(pill, "h-7 px-2.5 text-[12px]")}>
                      <Copy className="size-3" />
                      Copy
                    </button>
                  </span>
                </Step>
                <Step n={3}>Under User Management, add the name and Spotify email of everyone who'll connect, you included.</Step>
                <Step n={4}>
                  <span>Paste its Client ID here:</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.replace(/\s/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && valid && changed && void save(clean)}
                      placeholder="32 letters and numbers"
                      aria-label="Spotify Client ID"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={64}
                      className={cn(
                        "h-9 w-72 max-w-full rounded-[10px] border bg-white/[0.07] px-3 font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3",
                        draft && !valid ? "border-red-400/60" : "border-transparent focus:border-accent/60",
                      )}
                    />
                    <button onClick={() => void save(clean)} disabled={!valid || !changed || saving} className={pill}>
                      Save
                    </button>
                    {info.own && (
                      <button onClick={() => void save(null)} disabled={saving} className={pill}>
                        {info.builtIn ? "Use the built-in app" : "Remove"}
                      </button>
                    )}
                  </span>
                  {draft && !valid && <span className="mt-1 block text-[12px] text-bad">A Client ID is 32 letters and numbers.</span>}
                </Step>
              </ol>
              <p className="mt-2.5 text-[12px] text-ink-3">It's used from the next time you connect.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[11px] font-semibold tabular-nums text-ink-2">{n}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}
