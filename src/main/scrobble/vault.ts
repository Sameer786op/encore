import { safeStorage } from "electron";
import type { Vault } from "./scrobbler";

// Keys and tokens are encrypted with the Windows user account (DPAPI) through
// Electron. Where that isn't available they're only encoded, so they still
// never sit in the database as plain readable text.

export const electronVault: Vault = {
  encrypt(text) {
    if (safeStorage.isEncryptionAvailable()) return `safe:${safeStorage.encryptString(text).toString("base64")}`;
    return `plain:${Buffer.from(text, "utf8").toString("base64")}`;
  },
  decrypt(text) {
    if (text.startsWith("safe:")) return safeStorage.decryptString(Buffer.from(text.slice(5), "base64"));
    return Buffer.from(text.replace(/^plain:/, ""), "base64").toString("utf8");
  },
};
