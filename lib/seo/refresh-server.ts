// The SEO page refresher (./refresh.ts) bound to the real pipeline and database: one per server
// instance, so requests on one instance share a page's running refresh.
import "server-only";
import { deployEnv } from "@/lib/env";
import { continueSeoRun, examplePreviewRun, refreshSearch } from "@/lib/search/server";
import { serviceClient } from "@/lib/supabase/server";
import { supabaseSnapshotStore } from "./db";
import { createSeoRefresher } from "./refresh";

/**
 * Stored results are written by the live site only. Dev and preview deployments share its
 * database: a refresh there would replace production's snapshots with runs made elsewhere (and
 * pay for them), so it does nothing, and a first render there stores nothing.
 */
export function snapshotWritesAllowed(): boolean {
  return deployEnv() === "production";
}

export const seoRefresher = createSeoRefresher({
  store: () => supabaseSnapshotStore(serviceClient()),
  search: refreshSearch,
  continueRun: continueSeoRun,
  preview: examplePreviewRun,
  writesAllowed: snapshotWritesAllowed,
});
