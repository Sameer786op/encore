import { useSettings } from "@/settings/store";
import { toast } from "@/ui/toast";
import { lostOutput, type Output } from "./devices";
import { usePlayer } from "./store";

// Pauses when the speakers or headphones the music was playing on go away,
// so unplugging headphones doesn't suddenly play out loud on the speakers.

async function outputs(): Promise<Output[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audiooutput").map((d) => ({ id: d.deviceId, group: d.groupId }));
  } catch {
    return [];
  }
}

export function connectOutputWatch(): () => void {
  const devices = navigator.mediaDevices;
  if (!devices?.enumerateDevices) return () => undefined;
  let known = outputs();

  const onChange = async () => {
    const before = await known;
    known = outputs();
    const after = await known;
    const player = usePlayer.getState();
    if (!useSettings.getState().pauseOnUnplug || (player.status !== "playing" && player.status !== "loading")) return;
    if (!lostOutput(before, after)) return;
    player.togglePlay();
    toast("Paused: your audio device was disconnected");
  };

  devices.addEventListener("devicechange", onChange);
  return () => devices.removeEventListener("devicechange", onChange);
}
