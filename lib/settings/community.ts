// The "join our community" link the owner sets in /admin/settings ("קישור לקהילה"). Null when it
// is unset, switched off or unreadable; the footer shows the button only for a non-null result.
// Cached with the other public settings (./queries.ts: 5 minutes, tag "settings", which the
// admin's save expires), so pages that show it stay static.
import "server-only";
import type { CommunityLink } from "./community-link";
import { publicSettings } from "./queries";

export type { CommunityLink } from "./community-link";

/** The link and label to show, or null (unset, "הצגה באתר" off, or the read failed). Never throws. */
export async function getCommunityLink(): Promise<CommunityLink | null> {
  try {
    return (await publicSettings()).community;
  } catch {
    return null; // publicSettings never throws; this only guards the footer
  }
}
