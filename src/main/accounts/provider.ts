import type { SourceTrack } from "@shared/types";

// What Vyse Music reads from a connected account. Each service has its own
// reader; the sync turns what they return into playlists in Your Library.

export interface RemotePlaylist {
  remoteId: string;
  name: string;
  /** the account's liked songs */
  liked?: boolean;
  /** changes whenever the playlist does, when the service says (Spotify's snapshot id, Apple's last-modified date) */
  version?: string;
}

export interface RemoteSong extends SourceTrack {
  /** when it was added to the playlist there */
  addedAt?: string;
}

export interface RemoteArtist {
  name: string;
  /** the YouTube Music artist id, when the service already knows it */
  id?: string;
  artwork?: string;
}

export interface AccountProvider {
  /** who is signed in; throws SignedOutError when the sign-in is gone */
  whoAmI(): Promise<{ name?: string }>;
  /** every playlist in the account, the liked songs first */
  playlists(): Promise<RemotePlaylist[]>;
  songs(playlist: RemotePlaylist): Promise<RemoteSong[]>;
  /** artists the account follows */
  artists?(): Promise<RemoteArtist[]>;
}

/** the service no longer accepts the sign-in: it ran out, or the password changed */
export class SignedOutError extends Error {}

/** the service turned Vyse Music away for a reason the person can do something about; the message says what, and is shown as it is */
export class AccountRefusedError extends Error {}

/** a sign-in finished in the person's own browser: the code to enter there, and the page to enter it on */
export interface SignInCode {
  code: string;
  url: string;
}

/** where an account's sign-in comes from: the window or browser page the person signs in through, and what it leaves behind */
export interface AccountAuth {
  /** start signing in; true once signed in. A sign-in done in the browser passes the code to show through `showCode` */
  signIn(showCode?: (code: SignInCode) => void): Promise<boolean>;
  /** forget the sign-in: cookies, saved site data and any token held */
  signOut(): Promise<void>;
  /** stop a sign-in that's still waiting; it then ends as not signed in */
  cancel?(): void;
  /** open the sign-in page again, for when it was closed */
  reopen?(): void;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
