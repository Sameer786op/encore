// Working out from two lists of audio outputs whether the one we were
// playing on went away.

export interface Output {
  id: string;
  group: string;
}

/** true when the device that was playing (Windows' default output) is no longer there */
export function lostOutput(before: Output[], after: Output[]): boolean {
  const playingOn = before.find((d) => d.id === "default")?.group;
  // "default" moving to another device is normal when one is plugged in; only a missing one counts
  if (playingOn) return !after.some((d) => d.group === playingOn && d.id !== "default");
  return after.length < before.length;
}
