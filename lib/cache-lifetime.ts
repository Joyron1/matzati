// A cached page's lifetime is the shortest of the cached reads it made during its render (Next's
// revalidate rule). shortLived() is such a read, of one minute: a cached page that rendered an
// error or an empty state (AliExpress down, a cold cache during a build) calls it, so the next
// visit after a minute renders it again instead of serving the error for the page's full
// lifetime (12 hours for "כל המוצרים", 2026-10-08).
import "server-only";
import { unstable_cache } from "next/cache";

export const SHORT_LIFETIME_SECONDS = 60;

const marker = unstable_cache(async () => true, ["short-lived-render"], {
  revalidate: SHORT_LIFETIME_SECONDS,
});

/** Makes the page being rendered live SHORT_LIFETIME_SECONDS at most. Never throws. */
export async function shortLived(): Promise<void> {
  try {
    await marker();
  } catch {
    // Outside a render (tests, scripts) there is nothing to shorten.
  }
}
