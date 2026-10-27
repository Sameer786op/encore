import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, X } from "lucide-react";
import { useToasts } from "@/ui/toast";
import { KindDot } from "./common";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-[102px] left-[calc(50%+var(--sidebar-w)/2)] z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.94, transition: { duration: 0.18, ease: [0.32, 0.72, 0, 1] } }}
            transition={{ type: "spring", stiffness: 480, damping: 32 }}
            className="glass-menu pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-full py-2 pl-4 pr-2 text-[13.5px] font-semibold text-ink"
          >
            {t.kind === "error" ? <CircleAlert className="size-4 shrink-0 text-bad" /> : <KindDot />}
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
                className="pressable rounded-full px-2.5 py-1 text-[13.5px] font-semibold text-accent-ink hover:bg-accent/10"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="pressable rounded-full p-1 text-ink-3 hover:bg-white/10 hover:text-ink">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
