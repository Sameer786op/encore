import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { GLOBAL_COMMANDS, globalKeysFor, toAccelerator, type GlobalCommand, type GlobalKeysConfig } from "@shared/shortcuts";
import { Toggle } from "@/components/common";
import { cn } from "@/lib/cn";
import { useSettings } from "@/settings/store";
import { COMMANDS, SHORTCUT_GROUPS, comboOf, comboParts, commandUsing, keysFor, pauseGlobalKeys, useGlobalKeyStates } from "@/ui/shortcuts";
import { toast } from "@/ui/toast";
import { Card, Group } from "./parts";

// Settings → Keyboard shortcuts: change the keys for anything in the app, and
// pick the shortcuts that keep working while Encore is in the background.

const spoken = (combo: string) => comboParts(combo).join("+");

export const GLOBAL_SHORTCUTS_ID = "global-shortcuts";

export function Keys({ combo }: { combo: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {comboParts(combo).map((part, i) => (
        <kbd key={i} className="min-w-[22px] rounded-md bg-white/[0.08] px-1.5 py-0.5 text-center font-sans text-[12px] font-medium text-ink-2">
          {part}
        </kbd>
      ))}
    </span>
  );
}

/** shows the keys; click it, then press new ones. Esc cancels and Backspace turns the shortcut off */
function KeyRecorder({
  label,
  combos,
  onRecord,
  onClear,
  onRecording,
  accept,
}: {
  label: string;
  combos: string[];
  onRecord: (combo: string) => void;
  onClear: () => void;
  onRecording?: (on: boolean) => void;
  accept?: (combo: string) => boolean;
}) {
  const [recording, setRecording] = useState(false);
  // a Space or Enter that set the new keys also lands on this button as a (keyboard) click
  const finishedAt = useRef(0);
  const finish = () => {
    finishedAt.current = performance.now();
    setRecording(false);
  };

  useEffect(() => {
    if (!recording) return;
    onRecording?.(true);
    // first in line, so the shortcuts themselves stay quiet while recording
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      if (plain && event.key === "Escape") return finish();
      if (plain && (event.key === "Backspace" || event.key === "Delete")) {
        onClear();
        return finish();
      }
      const combo = comboOf(event);
      if (!combo || (accept && !accept(combo))) return;
      onRecord(combo);
      finish();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      onRecording?.(false);
    };
  }, [recording]);

  return (
    <button
      type="button"
      aria-label={recording ? `Press the new keys for ${label}` : `Change the keys for ${label}`}
      onClick={(e) => (e.detail > 0 || performance.now() - finishedAt.current > 400) && setRecording(!recording)}
      onBlur={() => recording && setRecording(false)}
      className={cn(
        "pressable inline-flex min-h-[30px] min-w-[110px] items-center justify-end gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.06]",
        recording && "bg-accent/15 ring-1 ring-accent/60 hover:bg-accent/15",
      )}
    >
      {recording ? (
        <span className="text-[12.5px] text-ink-2">Press keys…</span>
      ) : combos.length ? (
        combos.map((combo, i) => (
          <span key={combo} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-[11.5px] text-ink-3">or</span>}
            <Keys combo={combo} />
          </span>
        ))
      ) : (
        <span className="text-[12.5px] text-ink-3">Off</span>
      )}
    </button>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="pressable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-accent hover:bg-white/[0.06]">
      <RotateCcw className="size-3.5" /> Reset to defaults
    </button>
  );
}

/** keep only the commands whose keys differ from where they started */
function tidy(overrides: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(overrides).filter(([id, combos]) => JSON.stringify(combos) !== JSON.stringify(COMMANDS.find((c) => c.id === id)?.keys)));
}

function tidyGlobal(keys: GlobalKeysConfig["keys"]): GlobalKeysConfig["keys"] {
  return Object.fromEntries(Object.entries(keys).filter(([id, combo]) => combo !== GLOBAL_COMMANDS.find((c) => c.id === id)?.keys));
}

export function ShortcutSettings() {
  const overrides = useSettings((s) => s.shortcuts);
  const update = useSettings((s) => s.update);
  const keys = keysFor(overrides);

  const record = (id: string, label: string, combo: string) => {
    const next = { ...overrides, [id]: [combo] };
    const other = commandUsing(combo, overrides, id);
    if (other) {
      next[other.id] = keys[other.id].filter((c) => c !== combo);
      toast(`${spoken(combo)} now does "${label}" instead of "${other.label}"`);
    }
    update({ shortcuts: tidy(next) });
  };

  return (
    <Group
      title="Keyboard shortcuts"
      action={
        Object.keys(overrides).length > 0 && (
          <ResetButton
            onClick={() => {
              update({ shortcuts: {} });
              toast("Keyboard shortcuts are back to how they started");
            }}
          />
        )
      }
    >
      <Card>
        <p className="border-b border-white/[0.07] py-3 text-[12.5px] leading-relaxed text-ink-3">Click a shortcut, then press the keys you want. Esc cancels, Backspace turns it off.</p>
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group} className="border-b border-white/[0.07] pb-1.5 last:border-b-0">
            <h3 className="pb-0.5 pt-3.5 text-[12px] font-semibold text-ink-3">{group}</h3>
            {COMMANDS.filter((c) => c.group === group).map((command) => (
              <div key={command.id} className="flex min-h-[40px] items-center gap-6">
                <div className="min-w-0 flex-1 text-[13.5px]">{command.label}</div>
                <KeyRecorder
                  label={command.label}
                  combos={keys[command.id]}
                  onRecord={(combo) => record(command.id, command.label, combo)}
                  onClear={() => update({ shortcuts: tidy({ ...overrides, [command.id]: [] }) })}
                />
              </div>
            ))}
          </div>
        ))}
      </Card>
    </Group>
  );
}

const GLOBAL_PROBLEMS = {
  taken: "Another app is already using these keys. Pick different ones.",
  invalid: "Needs Ctrl or Alt, so normal typing isn't taken over.",
};

export function GlobalShortcutSettings() {
  const config = useSettings((s) => s.globalKeys);
  const overrides = useSettings((s) => s.shortcuts);
  const update = useSettings((s) => s.update);
  const states = useGlobalKeyStates((s) => s.states);
  const keys = globalKeysFor(config);
  const setKeys = (next: GlobalKeysConfig["keys"]) => update({ globalKeys: { ...config, keys: tidyGlobal(next) } });

  const record = (id: GlobalCommand, combo: string) => {
    const next = { ...config.keys, [id]: combo };
    const other = GLOBAL_COMMANDS.find((c) => c.id !== id && keys[c.id] === combo);
    const inApp = commandUsing(combo, overrides);
    if (other) {
      next[other.id] = "";
      toast(`${spoken(combo)} moved here from "${other.label}"`);
    } else if (inApp) {
      // Windows hands registered keys to Encore before the window sees them
      toast(`${spoken(combo)} now works everywhere, so inside Encore it no longer does "${inApp.label}"`);
    }
    setKeys(next);
  };

  const accept = (combo: string) => {
    if (toAccelerator(combo)) return true;
    toast("Shortcuts that work in the background need Ctrl or Alt");
    return false;
  };

  return (
    <Group
      id={GLOBAL_SHORTCUTS_ID}
      title="Shortcuts anywhere in Windows"
      action={
        <div className="flex items-center gap-3">
          {Object.keys(config.keys).length > 0 && <ResetButton onClick={() => setKeys({})} />}
          <Toggle checked={config.enabled} onChange={(enabled) => update({ globalKeys: { ...config, enabled } })} label="Shortcuts anywhere in Windows" />
        </div>
      }
    >
      <Card>
        <p className="border-b border-white/[0.07] py-3 text-[12.5px] leading-relaxed text-ink-3">
          These keep working while you're in another app, or with Encore tucked away in the tray. Your keyboard's media keys always work too.
        </p>
        <div inert={!config.enabled} className={cn("transition-opacity", !config.enabled && "opacity-45")}>
          {GLOBAL_COMMANDS.map((command) => {
            const state = config.enabled && keys[command.id] ? states[command.id] : undefined;
            return (
              <div key={command.id} className="flex min-h-[46px] items-center gap-6 border-b border-white/[0.07] py-1.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px]">{command.label}</div>
                  {state && state !== "ok" && <div className="mt-0.5 text-[12px] text-bad">{GLOBAL_PROBLEMS[state]}</div>}
                </div>
                <KeyRecorder
                  label={`${command.label}, anywhere in Windows`}
                  combos={keys[command.id] ? [keys[command.id]] : []}
                  accept={accept}
                  onRecording={pauseGlobalKeys}
                  onRecord={(combo) => record(command.id, combo)}
                  onClear={() => setKeys({ ...config.keys, [command.id]: "" })}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </Group>
  );
}
