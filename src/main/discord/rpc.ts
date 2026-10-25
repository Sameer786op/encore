import { randomUUID } from "node:crypto";
import net from "node:net";
import type { DiscordStatus } from "@shared/types";

// A small client for Discord's local RPC: the desktop app listens on a named
// pipe, we say hello with our application id, then set or clear an activity.
// Frames are an 8-byte header (opcode, length, little-endian) and JSON.

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;
const RETRY_MS = 20_000;

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/** pulls whole frames off a growing buffer */
export function decodeFrames(buffer: Buffer): { frames: { op: number; data: Record<string, unknown> }[]; rest: Buffer } {
  const frames: { op: number; data: Record<string, unknown> }[] = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const op = buffer.readUInt32LE(offset);
    const length = buffer.readUInt32LE(offset + 4);
    if (buffer.length - offset - 8 < length) break;
    const json = buffer.subarray(offset + 8, offset + 8 + length).toString("utf8");
    try {
      frames.push({ op, data: JSON.parse(json) as Record<string, unknown> });
    } catch {
      // a broken frame; skip it
    }
    offset += 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function pipePath(index: number): string {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${index}`;
  const dir = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? "/tmp";
  return `${dir.replace(/\/$/, "")}/discord-ipc-${index}`;
}

function connectTo(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export class DiscordRpc {
  private socket: net.Socket | null = null;
  private clientId = "";
  private enabled = false;
  private ready = false;
  private activity: Record<string, unknown> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: DiscordStatus = { state: "off" };
  private listeners = new Set<(status: DiscordStatus) => void>();

  getStatus(): DiscordStatus {
    return this.status;
  }

  onStatus(listener: (status: DiscordStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: DiscordStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  configure(enabled: boolean, clientId: string): void {
    const changed = clientId !== this.clientId || enabled !== this.enabled;
    this.enabled = enabled;
    this.clientId = clientId;
    if (!changed) return;
    this.disconnect();
    if (enabled && clientId) void this.connect();
    else this.setStatus({ state: "off" });
  }

  /** null clears the status */
  setActivity(activity: Record<string, unknown> | null): void {
    this.activity = activity;
    if (this.ready) this.sendActivity();
  }

  private sendActivity(): void {
    this.socket?.write(encodeFrame(OP_FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: this.activity ?? undefined }, nonce: randomUUID() }));
  }

  private async connect(): Promise<void> {
    if (!this.enabled || !this.clientId || this.socket) return;
    this.setStatus({ state: "connecting" });
    let socket: net.Socket | null = null;
    for (let i = 0; i < 10 && !socket; i++) socket = await connectTo(pipePath(i)).catch(() => null);
    if (!socket) {
      this.setStatus({ state: "not-running" });
      this.scheduleRetry();
      return;
    }
    if (!this.enabled) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const frame of frames) this.handle(frame.op, frame.data);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (this.enabled && this.status.state !== "error") {
        this.setStatus({ state: "not-running" });
        this.scheduleRetry();
      }
    });
    socket.on("error", () => socket.destroy());
    socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
  }

  private handle(op: number, data: Record<string, unknown>): void {
    if (op === OP_PING) {
      this.socket?.write(encodeFrame(OP_PONG, data));
    } else if (op === OP_CLOSE) {
      // usually an unknown application id
      this.setStatus({ state: "error", message: typeof data.message === "string" ? data.message : "Check the application ID" });
      this.disconnect(false);
    } else if (op === OP_FRAME && data.evt === "READY") {
      this.ready = true;
      this.setStatus({ state: "connected" });
      if (this.activity) this.sendActivity();
    } else if (op === OP_FRAME && data.evt === "ERROR") {
      const message = (data.data as { message?: string } | undefined)?.message;
      if (message) this.setStatus({ state: "connected", message });
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.enabled) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, RETRY_MS);
  }

  disconnect(resetStatus = true): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.destroy();
    if (resetStatus) this.setStatus({ state: this.enabled && this.clientId ? "connecting" : "off" });
  }
}
