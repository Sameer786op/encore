import vm from "node:vm";
import { Innertube, Log, Platform, UniversalCache } from "youtubei.js";

Log.setLevel(Log.Level.ERROR);

// youtubei.js needs to run snippets of YouTube's player script to decipher
// stream URLs. Run them in an isolated context with no access to Node.
Platform.shim.eval = (data) =>
  vm.runInNewContext(`(function () {\n${data.output}\n})()`, Object.create(null), { timeout: 5_000 });

const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

let cacheDir: string | undefined;
let current: { client: Promise<Innertube>; createdAt: number } | null = null;

export function configureYouTube(options: { cacheDir: string }): void {
  cacheDir = options.cacheDir;
}

/** a new session with YouTube's player script, which deciphers stream URLs; the script is cached on disk */
export function createYouTube(): Promise<Innertube> {
  return Innertube.create({
    retrieve_player: true,
    cache: cacheDir ? new UniversalCache(true, cacheDir) : undefined,
  });
}

/** one shared session, recreated every few hours or after it breaks */
export function getYouTube(): Promise<Innertube> {
  if (current && Date.now() - current.createdAt < SESSION_MAX_AGE_MS) return current.client;
  const client = createYouTube();
  current = { client, createdAt: Date.now() };
  client.catch(() => {
    if (current?.client === client) current = null;
  });
  return client;
}

export function resetYouTube(): void {
  current = null;
}
