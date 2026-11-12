/** thrown when something took longer than the player can wait */
export class TimeoutError extends Error {}

/**
 * The promise's result, unless it takes longer than `ms`: then a TimeoutError
 * instead, so a request that never answers can't hold a song up for good.
 * Whatever was started carries on in the background; only the wait ends.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what} took more than ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
