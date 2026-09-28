// One retry after a short back-off, for the SEO page refresh (refreshSearch in
// lib/search/server.ts). AliExpress's frequency ban (ApiCallLimit, about a second, shared by every
// caller of the app key) fails a search that happens to start next to another one; the same
// search a few seconds later usually works. Pure apart from the clock and sleep it is given.

export interface RetryOptions<T> {
  /** True for a result worth one more try (an upstream or rate-limit failure). */
  retryable: (result: T) => boolean;
  backoffMs: number;
  /** Time the second try may need: it starts only when this much is left before `deadline`. */
  roomMs: number;
  /** Epoch ms by which the caller must be done (the function's time limit, less a margin). */
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `attempt`, and once more after `backoffMs` when its result is retryable and time allows. */
export async function retryOnce<T>(
  attempt: () => Promise<T>,
  { retryable, backoffMs, roomMs, deadline, now = Date.now, sleep = wait }: RetryOptions<T>,
): Promise<T> {
  const first = await attempt();
  if (!retryable(first) || now() + backoffMs + roomMs > deadline) return first;
  await sleep(backoffMs);
  return attempt();
}
