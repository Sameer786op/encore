import { useSettings, type Settings } from "@/settings/store";

// Settings that change how the glass looks live in CSS variables, so every
// pane picks them up at once without re-rendering.

const GLASS_ALPHA: Record<Settings["glass"], string> = { clear: "0.3", tinted: "0.64" };

// with transparency effects turned off in Windows, the glass is nearly solid
const reduceTransparency = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-transparency: reduce)") : null;

function apply(glass: Settings["glass"]): void {
  const alpha = reduceTransparency?.matches ? "0.9" : (GLASS_ALPHA[glass] ?? GLASS_ALPHA.clear);
  document.documentElement.style.setProperty("--glass-alpha", alpha);
}

export function connectAppearance(): () => void {
  apply(useSettings.getState().glass);
  const onSystemChange = () => apply(useSettings.getState().glass);
  reduceTransparency?.addEventListener("change", onSystemChange);
  const stop = useSettings.subscribe((s, prev) => {
    if (s.glass !== prev.glass) apply(s.glass);
  });
  return () => {
    stop();
    reduceTransparency?.removeEventListener("change", onSystemChange);
  };
}
