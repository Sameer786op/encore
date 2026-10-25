import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Copy, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import type { AccountService, AccountStatus, SyncedPlaylistInfo } from "@shared/types";
import { ACCOUNT_NAMES, ACCOUNT_SERVICES } from "@shared/types";
import { useAccounts } from "@/accounts/store";
import { Toggle } from "@/components/common";
import { ServiceIcon } from "@/components/ServiceIcon";
import { plural, timeAgo } from "@/lib/format";
import { openModal } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { cn } from "@/lib/cn";
import { Card } from "./parts";

const WHAT: Record<AccountService, string> = {
  spotify: "Your playlists and Liked Songs, kept up to date here.",
  youtube: "Your playlists and Liked Music, kept up to date here.",
  apple: "Your library playlists, kept up to date here.",
};

function statusLine(account: AccountStatus): string {
  const who = account.name ? `Connected as ${account.name}` : "Connected";
  const p = account.progress;
  if (account.state === "syncing") {
    if (p && p.total > 0) return `Finding the songs of “${p.playlist}” · ${p.done.toLocaleString()} of ${p.total.toLocaleString()}`;
    if (p) return `Reading “${p.playlist}” · playlist ${p.step} of ${p.steps}`;
    return "Checking your playlists…";
  }
  return account.lastSync ? `${who} · Synced ${timeAgo(account.lastSync)}` : who;
}

function playlistLine(p: SyncedPlaylistInfo): string {
  if (!p.enabled) return "Not synced";
  if (!p.playlistId) return "Comes over with the next sync";
  return `${plural(p.songs, "song")}${p.missing ? ` · ${p.missing.toLocaleString()} not on YouTube Music` : ""}`;
}

const pill = "glass-control pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium hover:brightness-125 disabled:opacity-60";
const accentPill = "pressable inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-70";

function AccountRow({ account }: { account: AccountStatus }) {
  const [open, setOpen] = useState(false);
  const { service } = account;
  const name = ACCOUNT_NAMES[service];
  const syncing = account.state === "syncing";
  const connecting = account.state === "connecting";
  const synced = account.playlists.filter((p) => p.enabled);
  const songs = synced.reduce((n, p) => n + p.songs, 0);
  const progress = account.progress && account.progress.total > 0 ? account.progress.done / account.progress.total : null;

  const connect = async () => {
    if (await window.encore.accounts.connect(service)) toast(`${name} is connected. Your playlists are on their way.`);
  };
  const cancel = () => void window.encore.accounts.cancelConnect(service);
  const copyCode = (code: string) =>
    void navigator.clipboard.writeText(code).then(
      () => toast("Code copied"),
      () => undefined,
    );
  const disconnect = () => openModal({ kind: "disconnect-account", service, playlists: account.playlists.filter((p) => p.playlistId).length });

  return (
    <div className="border-b border-white/[0.07] py-4 last:border-b-0">
      <div className="flex items-center gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-white/[0.07]">
          <ServiceIcon service={service} className="size-[22px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{name}</div>
          <div className="mt-0.5 truncate text-[12.5px] text-ink-3">{account.connected ? statusLine(account) : WHAT[service]}</div>
        </div>
        {account.connected ? (
          <div className="flex shrink-0 items-center gap-2">
            {account.state === "signed-out" ? (
              <button onClick={() => void connect()} className={accentPill}>
                Connect again
              </button>
            ) : (
              <button onClick={() => void window.encore.accounts.sync(service)} disabled={syncing} title={`Look for changes on ${name} now`} className={pill}>
                <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
                {syncing ? "Syncing" : "Sync now"}
              </button>
            )}
            <button onClick={disconnect} aria-label={`Disconnect ${name}`} className={pill}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            {connecting && (
              <button onClick={cancel} aria-label={`Stop connecting ${name}`} className={pill}>
                Cancel
              </button>
            )}
            <button onClick={() => void connect()} disabled={connecting} aria-label={`Connect ${name}`} className={accentPill}>
              {connecting && <LoaderCircle className="size-4 animate-spin" />}
              {connecting ? "Waiting for sign-in" : "Connect"}
            </button>
          </div>
        )}
      </div>

      {syncing && progress !== null && (
        <div className="ml-14 mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${Math.max(3, progress * 100)}%` }} transition={{ type: "spring", stiffness: 140, damping: 26 }} />
        </div>
      )}
      {connecting && service !== "youtube" && (
        <p className="ml-14 mt-2 text-[12.5px] leading-relaxed text-ink-3">
          {service === "apple" ? "Click Sign In on the left of the Apple Music window that opened, then sign in." : `Sign in to ${name} in the window that opened.`} It closes by
          itself when you're done.
        </p>
      )}
      {connecting && service === "youtube" && (
        <div className="ml-14 mt-3 rounded-[14px] bg-white/[0.06] px-4 py-3.5">
          {account.signIn ? (
            <>
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                Google's page is open in your browser. Paste this code there (it's on your clipboard), pick your Google account and click Allow. There's no password to type.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span aria-label="Sign-in code" className="mr-2 select-all font-mono text-[22px] font-semibold tracking-[0.14em]">
                  {account.signIn.code}
                </span>
                <button onClick={() => copyCode(account.signIn!.code)} className={pill}>
                  <Copy className="size-3.5" />
                  Copy code
                </button>
                <button onClick={() => void window.encore.accounts.reopenSignIn(service)} className={pill}>
                  <ExternalLink className="size-3.5" />
                  Open the page again
                </button>
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-ink-3">Google calls it "YouTube on TV": that's the sign-in YouTube lets apps like this use.</p>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">Getting a sign-in code from Google…</p>
          )}
        </div>
      )}
      {account.error && !syncing && <p className="ml-14 mt-2 text-[12.5px] leading-relaxed text-[#ff6961]">{account.error}</p>}

      {account.connected && account.playlists.length > 0 && (
        <div className="ml-14">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="pressable -ml-2 mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-white/[0.06] hover:text-ink"
          >
            {plural(synced.length, "playlist")} · {plural(songs, "song")}
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
                <div className="mt-1.5 flex flex-col">
                  {account.playlists.map((p) => (
                    <div key={p.remoteId} className="flex items-center gap-3 border-t border-white/[0.05] py-2">
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-[13px]", !p.enabled && "text-ink-3")}>{p.name}</div>
                        <div className="text-[12px] text-ink-3">{playlistLine(p)}</div>
                      </div>
                      <Toggle checked={p.enabled} onChange={(on) => void window.encore.accounts.setPlaylistEnabled(service, p.remoteId, on)} label={`Sync ${p.name}`} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function AccountSettings() {
  const accounts = useAccounts((s) => s.accounts);
  return (
    <>
      <Card>
        {ACCOUNT_SERVICES.map((service) => {
          const account = accounts.find((a) => a.service === service) ?? { service, connected: false, state: "idle" as const, playlists: [] };
          return <AccountRow key={service} account={account} />;
        })}
      </Card>
      <div className="mt-2.5 space-y-1.5 px-4 text-[12px] leading-relaxed text-ink-3">
        <p>
          Bring your playlists over and keep them up to date: songs you add there show up here by themselves, every 15 minutes while Vyse Music is open. Songs still play free from
          YouTube Music, with no Premium needed. Nothing changes until you connect an account.
        </p>
        <p>
          You sign in on Spotify's, Google's or Apple's own page, so your password goes only to them; YouTube Music signs in with the Google account already in your browser. Vyse Music only reads your playlists, liked songs and the artists you follow; it never
          changes anything there. These services don't officially offer this to apps like Vyse Music, so a change on their side can stop a connection working until Vyse Music is updated.
        </p>
      </div>
    </>
  );
}
