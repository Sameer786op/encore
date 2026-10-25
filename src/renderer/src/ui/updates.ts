import { create } from "zustand";
import type { UpdateStatus } from "@shared/types";
import { toast } from "@/ui/toast";

export const useUpdates = create<UpdateStatus>(() => ({ state: "off", current: "" }));

/** keeps the update status current, and says so once when a new version is ready */
export function connectUpdates(): () => void {
  const apply = (status: UpdateStatus) => {
    const was = useUpdates.getState().state;
    useUpdates.setState(status, true);
    if (status.state === "ready" && was !== "ready") {
      toast(`Encore ${status.version} is ready`, {
        action: { label: "Restart", run: () => void window.encore.updates.install() },
        durationMs: 15_000,
      });
    }
  };
  void window.encore.updates.status().then(apply);
  return window.encore.updates.onStatus(apply);
}
