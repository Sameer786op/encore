// Builds the Microsoft Store package, release/Vyse-Music-Store-<version>.appx.
// Fill in the Partner Center values in electron-builder.store.yml first (see store/README.md).
//
//   npm run dist:store

import { execSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

// The Windows SDK's MakeAppx won't start from some folders under AppData\Local
// ("side-by-side configuration is incorrect"), where electron-builder keeps its
// tools by default, so they're kept with the project instead.
const env = { ...process.env, ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE ?? join(root, "node_modules/.cache/electron-builder") };

// npx is a .cmd script on Windows, which only starts through a shell
const npx = (command) => execSync(`npx ${command}`, { cwd: root, stdio: "inherit", env });

npx("electron-vite build");
npx("electron-builder --win appx --config electron-builder.store.yml --publish never");
console.log("Done. Upload the .appx from the release folder in Partner Center.");
