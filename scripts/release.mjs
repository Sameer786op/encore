// Builds the Windows installer and publishes it as a GitHub release, which is
// where installed copies of Encore look for updates.
//
//   npm version patch   (or minor / major) to raise the version first
//   npm run release
//
// Needs the GitHub CLI, signed in: gh auth login

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${version}`;

function gh() {
  const installed = "C:\\Program Files\\GitHub CLI\\gh.exe";
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return "gh";
  } catch {
    if (existsSync(installed)) return installed;
    throw new Error("The GitHub CLI isn't installed. Get it with: winget install --id GitHub.cli");
  }
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" && file === "npx", ...options });
}

const cli = gh();
execFileSync(cli, ["auth", "status"], { stdio: "ignore" });

// the release is made from what's on GitHub, so everything has to be committed
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) {
  console.error("Commit your changes first, then run this again.");
  process.exit(1);
}

let exists = true;
try {
  execFileSync(cli, ["release", "view", tag], { cwd: root, stdio: "ignore" });
} catch {
  exists = false;
}
if (exists) {
  console.error(`${tag} is already released. Raise the version first, e.g. npm version patch`);
  process.exit(1);
}

console.log(`Building Encore ${version}…`);
run("npx", ["electron-vite", "build"]);
run("npx", ["electron-builder", "--win", "--publish", "never"]);

const files = [`Encore-Setup-${version}.exe`, `Encore-Setup-${version}.exe.blockmap`, "latest.yml"].map((f) => join(root, "release", f));
for (const f of files) if (!existsSync(f)) throw new Error(`Missing ${f}`);
if (!readFileSync(files[2], "utf8").includes(`version: ${version}`)) throw new Error("release/latest.yml is for a different version");

console.log(`Publishing ${tag}…`);
run("git", ["push", "--follow-tags"]);
run(cli, ["release", "create", tag, ...files, "--title", `Encore ${version}`, "--generate-notes"]);
console.log(`Done. Installed copies will pick up ${version} within a few hours, or from Settings → About.`);
