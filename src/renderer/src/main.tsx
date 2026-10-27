import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/sora/wght.css";
import "./styles.css";

// The same page serves the main window and the floating mini player. Each
// loads only its own code: the mini player must never run the main player,
// which saves the queue as it closes.
const root = createRoot(document.getElementById("root")!);
if (window.location.hash === "#mini") {
  void import("./mini/MiniApp").then(({ MiniApp }) => root.render(<StrictMode><MiniApp /></StrictMode>));
} else {
  void import("./App").then(({ default: App }) => root.render(<StrictMode><App /></StrictMode>));
}
