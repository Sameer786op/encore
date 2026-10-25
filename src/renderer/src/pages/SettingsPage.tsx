import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ExternalLink, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import type { DiscordStatus, ScrobbleService, ScrobbleStatus, UpdateStatus } from "@shared/types";
import { Equalizer } from "@/components/Equalizer";
import { Segmented, Toggle } from "@/components/common";
import { describeQuality, useStreamQuality } from "@/player/quality";
import { useCurrentTrack, usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { useUpdates } from "@/ui/updates";
import { cn } from "@/lib/cn";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { MiniPlayerSettings } from "./settings/MiniPlayerSettings";
import { Card, Group, Row } from "./settings/parts";
import { GlobalShortcutSettings, ShortcutSettings } from "./settings/ShortcutSettings";

function updateBody(status: UpdateStatus): string {
  switch (status.state) {
    case "off":
      return status.store ? "The Microsoft Store keeps Vyse Music up to date." : "This copy doesn't update itself. Installed copies do.";
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return `Downloading Vyse Music ${status.version ?? ""}… ${status.progress ?? 0}%`;
    case "ready":
      return `Vyse Music ${status.version} is ready. It goes in when you restart.`;
    case "latest":
      return "You have the latest version.";
    case "error":
      return status.error ?? "Couldn't check for updates.";
    default:
      return "New versions download by themselves and go in when Vyse Music restarts.";
  }
}

/** the quality songs stream at, with what the current one is playing at */
function QualityRow() {
  const quality = useStreamQuality(useCurrentTrack());
  return (
    <Row
      title="Sound quality"
      body="Songs always stream at the best quality YouTube Music offers without Premium: Opus at about 130 to 160 kbps, 48 kHz. Higher quality needs a YouTube Music Premium sign-in. Your own music files play at their full quality, including lossless FLAC."
    >
      {quality && <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-2">{quality === "local" ? "Your file" : describeQuality(quality)}</span>}
    </Row>
  );
}

function UpdateRow() {
  const status = useUpdates();
  const busy = status.state === "checking" || status.state === "downloading";
  return (
    <Row title={status.current ? `Version ${status.current}` : "Version"} body={updateBody(status)}>
      {status.state === "ready" ? (
        <button onClick={() => void window.encore.updates.install()} className="pressable rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-on-accent hover:brightness-110">
          Restart to update
        </button>
      ) : status.state !== "off" ? (
        <button
          onClick={() => void window.encore.updates.check()}
          disabled={busy}
          className="glass-control pressable inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125 disabled:opacity-60"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {status.state === "error" ? "Try again" : "Check for updates"}
        </button>
      ) : null}
    </Row>
  );
}

const DISCORD_STATUS: Record<DiscordStatus["state"], [string, string]> = {
  off: ["Off", "bg-white/20"],
  connecting: ["Looking for Discord…", "bg-amber-400"],
  connected: ["Connected", "bg-switch"],
  "not-running": ["Discord isn't running. Vyse Music keeps trying in the background.", "bg-white/30"],
  error: ["Discord refused the connection", "bg-red-400"],
};

function DiscordSettings() {
  const discord = useSettings((s) => s.discord);
  const update = useSettings((s) => s.update);
  const [status, setStatus] = useState<DiscordStatus>({ state: "off" });
  const [draftId, setDraftId] = useState(discord.clientId);

  useEffect(() => {
    void window.encore.discord.status().then(setStatus);
    return window.encore.discord.onStatus(setStatus);
  }, []);

  const set = (patch: Partial<typeof discord>) => update({ discord: { ...discord, ...patch } });
  const validId = /^\d{15,22}$/.test(draftId.trim());
  const [label, dot] = DISCORD_STATUS[status.state];

  return (
    <Card>
      <Row title="Show what you're playing on Discord" body={'Your profile says "Listening to" with the song, artist, cover and a progress bar.'}>
        <Toggle checked={discord.enabled} onChange={(enabled) => set({ enabled })} label="Discord status" />
      </Row>
      <Row
        title="Discord application ID"
        body={
          <>
            Discord needs an app to show the status. Create one called "Vyse Music" at{" "}
            <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              discord.com/developers <ExternalLink className="size-3" />
            </a>
            , then paste its Application ID here.
          </>
        }
      >
        <div className="flex items-center gap-2">
          <input
            value={draftId}
            onChange={(e) => setDraftId(e.target.value.replace(/\D/g, ""))}
            onBlur={() => validId && set({ clientId: draftId.trim() })}
            onKeyDown={(e) => e.key === "Enter" && validId && set({ clientId: draftId.trim() })}
            placeholder="e.g. 1234567890123456789"
            inputMode="numeric"
            className={cn(
              "h-9 w-56 rounded-[10px] border bg-white/[0.07] px-3 text-[13px] tabular-nums outline-none placeholder:text-ink-3",
              draftId && !validId ? "border-red-400/60" : "border-transparent focus:border-accent/60",
            )}
          />
        </div>
      </Row>
      <Row title="Keep showing it when paused">
        <Toggle checked={discord.showWhenPaused} onChange={(showWhenPaused) => set({ showWhenPaused })} label="Show when paused" />
      </Row>
      {discord.enabled && (
        <div className="flex items-center gap-2 py-3 text-[12.5px] text-ink-2">
          <span className={cn("size-2 rounded-full", dot)} />
          {discord.clientId ? label : "Add an application ID to connect."}
          {status.state === "error" && status.message && <span className="text-ink-3">({status.message})</span>}
        </div>
      )}
    </Card>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
      {children} <ExternalLink className="size-3" />
    </a>
  );
}

function SecretInput({ value, onChange, placeholder, label, width = "w-72" }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; width?: string }) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value.trim())}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      className={cn("h-9 rounded-[10px] border border-transparent bg-white/[0.07] px-3 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent/60", width)}
    />
  );
}

function ConnectedAs({ user, service, onDisconnect }: { user?: string; service: string; onDisconnect: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
        <span className="size-2 rounded-full bg-switch" />
        <span>
          Connected{user && " as "}
          {user && <span className="font-semibold text-ink">{user}</span>}
        </span>
      </span>
      <button onClick={onDisconnect} aria-label={`Disconnect ${service}`} className="glass-control pressable rounded-full px-3.5 py-1.5 text-[12.5px] font-medium hover:brightness-125">
        Disconnect
      </button>
    </div>
  );
}

function ScrobbleSettings() {
  const [status, setStatus] = useState<ScrobbleStatus | null>(null);
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<ScrobbleService | null>(null);
  const [problem, setProblem] = useState<Partial<Record<ScrobbleService, string>>>({});

  useEffect(() => {
    void window.encore.scrobble.status().then(setStatus);
    return window.encore.scrobble.onStatus(setStatus);
  }, []);

  const run = async (service: ScrobbleService, work: () => Promise<ScrobbleStatus>) => {
    setBusy(service);
    setProblem((p) => ({ ...p, [service]: undefined }));
    try {
      setStatus(await work());
      if (service === "listenbrainz") setToken("");
      else setSecret("");
    } catch (error) {
      // errors from the main process arrive wrapped in Electron's own text
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error);
      setProblem((p) => ({ ...p, [service]: message }));
    } finally {
      setBusy(null);
    }
  };
  const disconnect = (service: ScrobbleService) => void window.encore.scrobble.disconnect(service).then(setStatus);

  if (!status) return null;
  const lb = status.listenbrainz;
  const fm = status.lastfm;
  const lbError = problem.listenbrainz ?? lb.error;
  const fmError = problem.lastfm ?? fm.error;

  return (
    <Card>
      <Row
        title="ListenBrainz"
        body={
          lb.connected ? (
            "Every song you play for long enough is added to your ListenBrainz history."
          ) : (
            <>
              Free and open source. Copy your user token from <Link href="https://listenbrainz.org/settings/">listenbrainz.org/settings</Link> and paste it here.
            </>
          )
        }
      >
        {lb.connected ? (
          <ConnectedAs user={lb.user} service="ListenBrainz" onDisconnect={() => disconnect("listenbrainz")} />
        ) : (
          <div className="flex items-center gap-2">
            <SecretInput value={token} onChange={setToken} placeholder="User token" label="ListenBrainz user token" width="w-64" />
            <button
              disabled={!token || busy === "listenbrainz"}
              onClick={() => void run("listenbrainz", () => window.encore.scrobble.connectListenBrainz(token))}
              className="inline-flex h-9 items-center gap-2 pressable rounded-full bg-accent px-4 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
            >
              {busy === "listenbrainz" && <LoaderCircle className="size-3.5 animate-spin" />} Connect
            </button>
          </div>
        )}
      </Row>
      {lbError && <div className="-mt-2 pb-3 text-[12.5px] text-bad">ListenBrainz: {lbError}</div>}

      <Row
        title="Last.fm"
        body={
          fm.connected ? (
            "Your plays show up on your Last.fm profile, along with what's playing right now."
          ) : fm.pending ? (
            "Last.fm opened in your browser. Approve Vyse Music there and this connects by itself."
          ) : (
            <>
              Last.fm needs its own free API account for Vyse Music. Create one at <Link href="https://www.last.fm/api/account/create">last.fm/api/account/create</Link> (any name and
              description will do), then paste the API key and shared secret it gives you.
            </>
          )
        }
      >
        {fm.connected ? (
          <ConnectedAs user={fm.user} service="Last.fm" onDisconnect={() => disconnect("lastfm")} />
        ) : fm.pending ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
              <LoaderCircle className="size-3.5 animate-spin" /> Waiting for approval…
            </span>
            <button onClick={() => disconnect("lastfm")} className="glass-control pressable rounded-full px-3.5 py-1.5 text-[12.5px] font-medium hover:brightness-125">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <SecretInput value={apiKey} onChange={setApiKey} placeholder="API key" label="Last.fm API key" />
            <div className="flex items-center gap-2">
              <SecretInput value={secret} onChange={setSecret} placeholder="Shared secret" label="Last.fm shared secret" width="w-[12.5rem]" />
              <button
                disabled={!apiKey || !secret || busy === "lastfm"}
                onClick={() => void run("lastfm", () => window.encore.scrobble.connectLastfm(apiKey, secret))}
                className="inline-flex h-9 items-center gap-2 pressable rounded-full bg-accent px-4 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
              >
                {busy === "lastfm" && <LoaderCircle className="size-3.5 animate-spin" />} Connect
              </button>
            </div>
          </div>
        )}
      </Row>
      {fmError && <div className="-mt-2 pb-3 text-[12.5px] text-bad">Last.fm: {fmError}</div>}

      {(lb.connected || fm.connected) && (
        <div className="border-t border-white/[0.07] py-3 text-[12.5px] text-ink-3">
          A song counts once you've heard half of it or four minutes, whichever comes first.
          {status.queued > 0 && ` ${status.queued === 1 ? "1 play is" : `${status.queued} plays are`} waiting to be sent; Vyse Music keeps trying while it's open.`}
        </div>
      )}
    </Card>
  );
}

const CROSSFADE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];

export function SettingsPage() {
  const settings = useSettings();
  const autoplay = usePlayer((s) => s.autoplay);
  const setAutoplay = usePlayer((s) => s.setAutoplay);
  const stepIndex = Math.max(0, CROSSFADE_STEPS.indexOf(settings.crossfadeSeconds));

  return (
    <div className="max-w-3xl px-8 pb-16 pt-[68px]">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
        className="font-display text-[34px] font-bold tracking-[-0.026em]"
      >
        Settings
      </motion.h1>

      <Group title="Appearance">
        <AppearanceSettings />
      </Group>

      <Group title="Playback">
        <Card>
          <Row
            title="Crossfade"
            body={settings.crossfadeSeconds === 0 ? "Off: each song starts the moment the last one ends, with no gap." : `Songs blend into each other over ${settings.crossfadeSeconds} seconds.`}
          >
            <div className="flex w-64 items-center gap-3">
              <input
                type="range"
                min={0}
                max={CROSSFADE_STEPS.length - 1}
                step={1}
                value={stepIndex}
                aria-label="Crossfade length"
                onChange={(e) => settings.update({ crossfadeSeconds: CROSSFADE_STEPS[Number(e.target.value)] })}
                className="range flex-1"
                style={{ "--fill": `${(stepIndex / (CROSSFADE_STEPS.length - 1)) * 100}%` } as React.CSSProperties}
              />
              <span className="w-10 text-right text-[13px] tabular-nums text-ink-2">{settings.crossfadeSeconds === 0 ? "Off" : `${settings.crossfadeSeconds}s`}</span>
            </div>
          </Row>
          <Row title="Crossfade inside albums" body="Off keeps albums gapless, the way live records and DJ mixes are meant to flow.">
            <Toggle checked={settings.crossfadeSameAlbum} onChange={(crossfadeSameAlbum) => settings.update({ crossfadeSameAlbum })} label="Crossfade inside albums" />
          </Row>
          <QualityRow />
          <Row title="Volume levelling" body="Plays every song at about the same loudness, so a quiet song isn't followed by a loud one.">
            <Toggle checked={settings.levelling} onChange={(levelling) => settings.update({ levelling })} label="Volume levelling" />
          </Row>
          <Row title="Autoplay" body="Keep playing similar songs when your queue ends.">
            <Toggle checked={autoplay} onChange={setAutoplay} label="Autoplay" />
          </Row>
          <Row
            title="Continue where you left off"
            body="If music was playing when Vyse Music closed, it carries on from the same spot when you open it. If not, the last song waits there, paused."
          >
            <Toggle checked={settings.continueOnOpen} onChange={(continueOnOpen) => settings.update({ continueOnOpen })} label="Continue where you left off" />
          </Row>
          <Row title="Keep playing when the window is closed" body="Closing Vyse Music while music plays moves it to the system tray by the clock. Right-click its icon there to quit.">
            <Toggle checked={settings.backgroundPlay} onChange={(backgroundPlay) => settings.update({ backgroundPlay })} label="Keep playing when the window is closed" />
          </Row>
          <Row title="Pause when headphones are unplugged" body="Also when Bluetooth headphones or speakers disconnect, so the music doesn't carry on out loud.">
            <Toggle checked={settings.pauseOnUnplug} onChange={(pauseOnUnplug) => settings.update({ pauseOnUnplug })} label="Pause when headphones are unplugged" />
          </Row>
          <Row title="Double-click a song" body={settings.doubleClick === "play" ? "Plays it now, followed by the rest of the list." : "Adds it to the end of your queue, without stopping what's playing."}>
            <Segmented
              label="Double-click a song"
              value={settings.doubleClick}
              options={[
                { value: "play", label: "Play" },
                { value: "queue", label: "Add to queue" },
              ]}
              onChange={(doubleClick) => settings.update({ doubleClick })}
            />
          </Row>
        </Card>
      </Group>

      <Group title="Equalizer" action={<Toggle checked={settings.eq.enabled} onChange={(enabled) => settings.updateEq({ enabled })} label="Equalizer" />}>
        <Equalizer />
      </Group>

      <Group title="Lyrics">
        <Card>
          <Row title="Text size" body="For the lyrics in the full-screen player.">
            <Segmented
              label="Lyrics size"
              value={settings.lyricsSize}
              onChange={(lyricsSize) => settings.update({ lyricsSize })}
              options={[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ]}
            />
          </Row>
        </Card>
      </Group>

      <Group title="Mini player">
        <MiniPlayerSettings />
      </Group>

      <Group title="New releases">
        <Card>
          <Row
            title="Tell me about new releases"
            body="A notification when an artist you listen to or follow puts out a new album or single. Vyse Music checks a few times a day while it's open."
          >
            <Toggle checked={settings.releaseAlerts} onChange={(releaseAlerts) => settings.update({ releaseAlerts })} label="New release notifications" />
          </Row>
        </Card>
      </Group>

      <ShortcutSettings />
      <GlobalShortcutSettings />

      <Group title="Scrobbling">
        <ScrobbleSettings />
      </Group>

      <Group title="Discord">
        <DiscordSettings />
      </Group>

      <Group title="About">
        <Card>
          <UpdateRow />
          <Row title="Vyse Music" body="Free and open source, with no ads and no account. Your library, history and settings stay on this computer.">
            <button onClick={() => void window.encore.app.openDataFolder()} className="glass-control pressable inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125">
              <FolderOpen className="size-4" /> Data folder
            </button>
          </Row>
        </Card>
      </Group>
    </div>
  );
}
