import { app } from "electron";
import updater from "electron-updater";
import type { UpdateStatus } from "@shared/types";

// Vyse Music updates itself from its GitHub releases: a new version downloads in
// the background and goes in when the app restarts, or right away from Settings.
// Copies from the Microsoft Store are left to the Store.

// every time the app opens, then every hour; coming back from the tray looks again if it's been a while
const FIRST_CHECK_MS = 3_000;
const CHECK_EVERY_MS = 3_600_000;
const STALE_MS = 10 * 60_000;

function friendly(error: Error): string {
  const message = error.message ?? "";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(message)) return "Couldn't reach GitHub. Check your internet connection.";
  if (/latest\.yml|404/i.test(message)) return "No version has been published yet.";
  return "Couldn't check for updates. Vyse Music will try again later.";
}

export class Updater {
  private status: UpdateStatus;
  private listeners = new Set<(status: UpdateStatus) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private lastCheck = 0;

  constructor(
    private readonly enabled: boolean,
    store = false,
  ) {
    this.status = { state: enabled ? "idle" : "off", current: app.getVersion(), store: store || undefined };
    if (!enabled) return;
    const { autoUpdater } = updater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on("checking-for-update", () => this.set({ state: "checking", error: undefined }));
    autoUpdater.on("update-available", (info) => this.set({ state: "downloading", version: info.version, progress: 0 }));
    autoUpdater.on("download-progress", (progress) => this.set({ state: "downloading", progress: Math.floor(progress.percent) }));
    autoUpdater.on("update-not-available", () => this.set({ state: "latest", version: undefined, progress: undefined }));
    autoUpdater.on("update-downloaded", (info) => this.set({ state: "ready", version: info.version, progress: 100 }));
    autoUpdater.on("error", (error) => this.set({ state: "error", error: friendly(error) }));
  }

  get(): UpdateStatus {
    return this.status;
  }

  onStatus(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.enabled) return;
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_MS));
    this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS));
  }

  /** look again if the last look was a while ago */
  checkIfStale(): void {
    if (Date.now() - this.lastCheck >= STALE_MS) void this.check();
  }

  async check(): Promise<UpdateStatus> {
    // nothing to do while one is on its way or waiting to go in
    if (!this.enabled || ["checking", "downloading", "ready"].includes(this.status.state)) return this.status;
    this.lastCheck = Date.now();
    // failures arrive through the "error" event
    await updater.autoUpdater.checkForUpdates().catch(() => undefined);
    return this.status;
  }

  install(): void {
    if (this.status.state !== "ready") return;
    // silent, and Vyse Music opens again once the new version is in
    updater.autoUpdater.quitAndInstall(true, true);
  }

  dispose(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }
}
