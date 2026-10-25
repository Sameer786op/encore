import logo from "@/assets/logo.png";

/** the Vyse Music mark on its tile, the same picture as the app icon (made by scripts/make-icons.mjs) */
export function Logo({ className }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden draggable={false} className={className} />;
}
