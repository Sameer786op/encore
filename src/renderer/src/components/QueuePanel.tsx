import { AnimatePresence, Reorder, motion } from "motion/react";
import { GripVertical, ListPlus, LoaderCircle, X } from "lucide-react";
import { useJam } from "@/jam/store";
import { usePlayer } from "@/player/store";
import { currentItem, upcomingItems, type QueueItem } from "@/player/queue";
import { cn } from "@/lib/cn";
import { artistNames } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { Artwork } from "./Artwork";
import { Toggle } from "./common";
import { JamAvatar, useJamGuest } from "./JamPanel";
import { LiquidGlass } from "./LiquidGlass";
import { PlayingBars } from "./PlayingBars";
import { trackMenu } from "./trackMenu";

/** rows beyond this are summarised so huge queues stay fast */
const SHOWN_UPCOMING = 80;

function QueueRow({ item, current, playing, onRemove, fixed }: { item: QueueItem; current?: boolean; playing?: boolean; onRemove?: () => void; fixed?: boolean }) {
  const jumpTo = usePlayer((s) => s.jumpTo);
  return (
    <div
      onDoubleClick={() => !current && jumpTo(item.uid)}
      onContextMenu={(e) => openMenu(e, trackMenu(item.track))}
      className={cn(
        "group flex items-center gap-3 rounded-[14px] px-2 py-1.5 transition-colors duration-200",
        // the playing song lit in the accent from the left, as in the track lists
        current ? "bg-[linear-gradient(90deg,rgb(var(--accent-rgb)/0.16),rgb(var(--accent-rgb)/0.03)_60%,transparent)] shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.16)]" : "hover:bg-white/[0.06]",
      )}
    >
      <Artwork src={item.track.artwork} className="size-10 rounded-[10px] shadow-[0_0_0_1px_var(--ring),0_4px_10px_-4px_rgb(0_0_0/calc(0.5*var(--shadow-k)))]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{item.track.title}</div>
        <div className="truncate text-[12px] text-ink-2">{artistNames(item.track.artists)}</div>
      </div>
      {/* in a Jam, who put it in the queue */}
      {item.by && (
        <span title={`Added by ${item.by}`} className="shrink-0">
          <JamAvatar name={item.by} className="size-5 text-[10px]" />
        </span>
      )}
      {!current && !fixed && <GripVertical className="size-3.5 shrink-0 cursor-grab text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />}
      {current && <PlayingBars paused={!playing} className="mr-1" />}
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${item.track.title} from the queue`} className="pressable rounded-full p-1 text-ink-3 opacity-0 hover:bg-white/10 hover:text-ink group-hover:opacity-100">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function QueuePanel() {
  const open = usePlayer((s) => s.queueOpen);
  const queue = usePlayer((s) => s.queue);
  const status = usePlayer((s) => s.status);
  const autoplay = usePlayer((s) => s.autoplay);
  const radioLoading = usePlayer((s) => s.radioLoading);
  const { setQueueOpen, removeFromQueue, reorderUpcoming, clearUpcoming, setAutoplay } = usePlayer.getState();
  const jamOn = useJam((s) => s.status !== "off" && s.status !== "joining");
  const people = useJam((s) => s.people);
  const hostName = useJam((s) => s.hostName);
  const jam = jamOn ? { people, hostName } : null;
  // a guest sees the host's queue, and arranges it only if the host lets them
  const guest = useJamGuest();
  const control = useJam((s) => s.control);
  const fixed = guest && !control;

  const current = currentItem(queue);
  const upcoming = upcomingItems(queue);
  const shown = upcoming.slice(0, SHOWN_UPCOMING);
  const saveAsPlaylist = () => {
    if (!current) return;
    const day = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    openModal({ kind: "create-playlist", name: `My queue, ${day}`, tracks: [current, ...upcoming].map((i) => i.track) });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 48, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 48, scale: 0.98, transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] } }}
          transition={{ type: "spring", stiffness: 340, damping: 34, mass: 0.9 }}
          className="absolute bottom-2 right-2 top-[52px] z-30 w-[352px]"
        >
          <LiquidGlass as="aside" area="player" radius={22} sheen className="flex h-full flex-col">
            <div className="flex items-center justify-between pb-2 pl-5 pr-3 pt-3.5">
              <h2 className="font-display text-[18px] font-bold tracking-[-0.03em]">Playing Next</h2>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={saveAsPlaylist}
                  disabled={!current}
                  aria-label="Save the queue as a playlist"
                  title="Save as playlist"
                  className="pressable grid size-7 place-items-center rounded-full bg-white/[0.08] text-ink-2 hover:bg-white/[0.14] hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                >
                  <ListPlus className="size-3.5" strokeWidth={2.4} />
                </button>
                <button onClick={() => setQueueOpen(false)} aria-label="Close queue" className="pressable grid size-7 place-items-center rounded-full bg-white/[0.08] text-ink-2 hover:bg-white/[0.14] hover:text-ink">
                  <X className="size-3.5" strokeWidth={2.6} />
                </button>
              </div>
            </div>

            {jam && (
              <div className="mx-2.5 mb-1 flex items-center gap-3 rounded-[16px] bg-accent/10 px-3.5 py-2.5">
                <div className="flex -space-x-1.5">
                  {jam.people.slice(0, 5).map((p) => (
                    <JamAvatar key={p.id} name={p.name} className="size-6 text-[11px]" />
                  ))}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13px] font-semibold">{guest ? `${jam.hostName}'s Jam` : "Your Jam"}</div>
                  <div className="text-[11.5px] leading-snug text-ink-3">{guest
                      ? control
                        ? "Everyone can change what plays."
                        : `${jam.hostName} chooses what plays. You can add songs.`
                      : `${jam.people.length} listening. ${control ? "Everyone can change what plays." : "Anyone can add songs."}`}</div>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%_-_14px),transparent)]">
              {current ? (
                <>
                  <div className="px-2 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3">Now playing</div>
                  <QueueRow item={current} current playing={status === "playing"} />
                </>
              ) : (
                <p className="px-2 py-10 text-center text-[13px] text-ink-3">Nothing is playing yet.</p>
              )}

              {upcoming.length > 0 && (
                <>
                  <div className="mt-4 flex items-center justify-between px-2 pb-1.5">
                    <div className="min-w-0">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3">Next up</div>
                      {queue.context && <div className="truncate text-[11.5px] text-ink-3">From {queue.context.label}</div>}
                    </div>
                    {!guest && (
                      <button onClick={clearUpcoming} className="pressable shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-accent-ink hover:bg-accent/10">
                        Clear
                      </button>
                    )}
                  </div>
                  {fixed ? (
                    <div className="flex flex-col">
                      {shown.map((item) => (
                        <QueueRow key={item.uid} item={item} fixed />
                      ))}
                    </div>
                  ) : (
                    <Reorder.Group axis="y" values={shown.map((i) => i.uid)} onReorder={(uids) => reorderUpcoming(uids)} className="flex flex-col">
                      {shown.map((item) => (
                        <Reorder.Item key={item.uid} value={item.uid} whileDrag={{ scale: 1.03, zIndex: 1 }} transition={{ type: "spring", stiffness: 500, damping: 40 }} className="relative">
                          <QueueRow item={item} onRemove={() => removeFromQueue(item.uid)} />
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>
                  )}
                  {upcoming.length > shown.length && <p className="px-2 pt-2 text-[12px] text-ink-3">and {upcoming.length - shown.length} more</p>}
                </>
              )}

              {radioLoading && (
                <div className="mt-4 flex items-center gap-2 px-2 text-[12px] text-ink-3">
                  <LoaderCircle className="size-3.5 animate-spin" /> Finding similar songs…
                </div>
              )}
            </div>

            <div className={cn("mx-2.5 mb-2.5 flex items-center gap-3 rounded-[16px] bg-white/[0.05] px-3.5 py-3", guest && "hidden")}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Autoplay</div>
                <div className="text-[11.5px] leading-snug text-ink-3">Keep playing similar songs when your queue ends</div>
              </div>
              <Toggle checked={autoplay} onChange={setAutoplay} label="Autoplay similar songs" />
            </div>
          </LiquidGlass>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
