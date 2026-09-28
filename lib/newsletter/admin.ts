// Reads for /admin/newsletter and its CSV export, with the service role. Callers check
// requireAdmin() first (the page and the export route both do). No bulk sending lives here.
import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { csvFileName, subscribersCsv } from "./csv";
import {
  countSubscribers,
  selectActiveSubscribers,
  selectAllActiveSubscribers,
  type SubscriberCounts,
  type SubscriberRow,
} from "./db";

/** Active subscribers per page of the admin list. */
export const ADMIN_PAGE_SIZE = 50;

export interface NewsletterOverview {
  counts: SubscriberCounts;
  rows: SubscriberRow[];
  /** 1-based, clamped to the pages there are. */
  page: number;
  /** At least 1. */
  pages: number;
}

/** The page count for `active` rows (1 when there are none). */
export function pageCount(active: number, pageSize = ADMIN_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(active / pageSize));
}

/** Counts and one page of the list. Throws NewsletterDbError. */
export async function loadNewsletterOverview(requestedPage: number): Promise<NewsletterOverview> {
  const db = serviceClient();
  const counts = await countSubscribers(db);
  const pages = pageCount(counts.active);
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
  const rows = await selectActiveSubscribers(db, (page - 1) * ADMIN_PAGE_SIZE, ADMIN_PAGE_SIZE);
  return { counts, rows, page, pages };
}

/** The CSV of every active subscriber. Throws NewsletterDbError. */
export async function exportActiveSubscribers(
  now: Date,
): Promise<{ body: string; fileName: string; rows: number }> {
  const rows = await selectAllActiveSubscribers(serviceClient());
  return { body: subscribersCsv(rows), fileName: csvFileName(now), rows: rows.length };
}
