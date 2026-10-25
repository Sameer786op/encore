import { SignedOutError, sleep } from "./provider";

// JSON calls to a service's web API with the sign-in its own web app uses.
// A refused sign-in is fetched again once (it may only have run out); a
// second refusal means the person has to sign in again.

export interface ApiAuth {
  /** headers that carry the sign-in; `fresh` asks for a new one instead of the one held */
  headers(fresh?: boolean): Promise<Record<string, string>>;
}

export type Fetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

const MAX_WAIT_MS = 30_000;

/**
 * The parsed body, or null when there's nothing there or it isn't ours to read (404, or a
 * 403 the service doesn't use for sign-ins). `signedOut` lists the statuses that mean the
 * sign-in itself was refused.
 */
export async function getJson<T>(url: string, auth: ApiAuth, fetchImpl: Fetch = fetch, signedOut = [401, 403]): Promise<T | null> {
  let fresh = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchImpl(url, { headers: await auth.headers(fresh), signal: AbortSignal.timeout(30_000) });
    if (signedOut.includes(res.status)) {
      if (fresh) throw new SignedOutError(`Signed out (${res.status})`);
      fresh = true;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      // too many calls, or a hiccup on their side: wait as long as they ask, then try again
      const seconds = Number(res.headers.get("retry-after"));
      await sleep(Math.min(MAX_WAIT_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2_000 * (attempt + 1)));
      continue;
    }
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error(`${new URL(url).host} kept refusing`);
}
