import { readFileSync } from "node:fs";
import type { AccountService } from "@shared/types";
import { ACCOUNT_SERVICES } from "@shared/types";
import { SignedOutError, sleep, type AccountAuth, type AccountProvider, type RemoteArtist, type RemoteSong } from "./provider";

// For automated tests: accounts whose playlists come from a JSON file the test
// edits between syncs, and a sign-in that succeeds without a window or browser.

interface StandinAccount {
  name?: string;
  /** the service stopped accepting the sign-in */
  signedOut?: boolean;
  /** the person closes the sign-in window without signing in */
  refuseSignIn?: boolean;
  /** signs in through the browser with this code, once the test sets `approved` */
  code?: string;
  approved?: boolean;
  playlists: { id: string; name: string; liked?: boolean; version?: string; songs: RemoteSong[] }[];
  artists?: RemoteArtist[];
}

export function standinAccounts(path: string): { providers: Record<AccountService, AccountProvider>; auth: Record<AccountService, AccountAuth> } {
  const read = (service: AccountService): StandinAccount | undefined => (JSON.parse(readFileSync(path, "utf8")) as Partial<Record<AccountService, StandinAccount>>)[service];
  const account = (service: AccountService): StandinAccount => {
    const found = read(service);
    if (!found || found.signedOut) throw new SignedOutError("Stand-in signed out");
    return found;
  };
  const providers = {} as Record<AccountService, AccountProvider>;
  const auth = {} as Record<AccountService, AccountAuth>;
  for (const service of ACCOUNT_SERVICES) {
    providers[service] = {
      whoAmI: async () => ({ name: account(service).name }),
      playlists: async () => account(service).playlists.map((p) => ({ remoteId: p.id, name: p.name, liked: p.liked, version: p.version })),
      songs: async (playlist) => account(service).playlists.find((p) => p.id === playlist.remoteId)?.songs ?? [],
      artists: async () => account(service).artists ?? [],
    };
    let cancelled = false;
    auth[service] = {
      signIn: async (showCode) => {
        cancelled = false;
        await sleep(300);
        const code = read(service)?.code;
        if (code) {
          showCode?.({ code, url: "https://www.google.com/device" });
          while (!cancelled && !read(service)?.approved && !read(service)?.refuseSignIn) await sleep(200);
          if (cancelled) return false;
        }
        return !read(service)?.refuseSignIn;
      },
      signOut: async () => undefined,
      cancel: () => {
        cancelled = true;
      },
    };
  }
  return { providers, auth };
}
