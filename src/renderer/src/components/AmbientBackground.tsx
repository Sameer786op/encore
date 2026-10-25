import { usePageBackdrop } from "./Backdrop";

/** puts this page's cover behind the whole app while the page is open */
export function AmbientBackground({ src }: { src?: string }) {
  usePageBackdrop(src);
  return null;
}
