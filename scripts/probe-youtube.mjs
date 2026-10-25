// Diagnostic: checks that YouTube Music search works and which InnerTube
// clients hand out audio URLs we can actually download from this machine.
// Usage: node scripts/probe-youtube.mjs "search words"
import { Innertube, Platform } from "youtubei.js";

// youtubei.js needs an evaluator to run YouTube's signature functions
Platform.shim.eval = (data, env) => new Function(data.output)();

const query = process.argv[2] ?? "blinding lights the weeknd";
const CLIENTS = ["VISIONOS", "ANDROID_VR", "IOS", "TV", "YTMUSIC", "MWEB", "WEB"];

const yt = await Innertube.create({ retrieve_player: true });
console.log(`visitor data: ${yt.session.context.client.visitorData ? "yes" : "no"}`);

const search = await yt.music.search(query, { type: "song" });
const songs = search.songs?.contents ?? [];
console.log(`search "${query}": ${songs.length} songs`);
for (const s of songs.slice(0, 3)) {
  console.log(`  ${s.id}  ${s.title}  —  ${s.artists?.map((a) => a.name).join(", ")}  (${s.duration?.text})`);
}

const videoId = songs[0]?.id;
if (!videoId) process.exit(1);

for (const client of CLIENTS) {
  try {
    const info = await yt.getBasicInfo(videoId, { client });
    const status = info.playability_status?.status;
    const format = info.chooseFormat({ type: "audio", quality: "best" });
    const url = await format.decipher(yt.session.player);
    const sabr = new URL(url).searchParams.get("sabr");
    const head = await fetch(url, { headers: { range: "bytes=0-65535" } });
    const mid = await fetch(url, { headers: { range: `bytes=${2_000_000}-${2_065_535}` } });
    console.log(
      `${client.padEnd(11)} ${status} itag ${format.itag} ${format.mime_type?.split(";")[0]} ${Math.round((format.bitrate ?? 0) / 1000)}kbps ` +
        `loudness ${info.player_config?.audio_config?.loudness_db ?? "?"} sabr ${sabr ?? "-"} -> start ${head.status}, mid ${mid.status}`,
    );
  } catch (error) {
    console.log(`${client.padEnd(11)} failed: ${String(error?.message ?? error).split("\n")[0].slice(0, 110)}`);
  }
}
