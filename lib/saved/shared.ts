// A saved list shared with a friend (owner request 2026-10-24): the link carries only product ids
// (/shared?ids=1,2,3), never anything about who shared it, and opens our own page of those products
// (app/shared/page.tsx). Client-safe: no server imports here.
import { SITE_HOST } from "@/lib/config/site";

/** At most this many products in a shared link (a WhatsApp message stays short). */
export const SHARED_MAX = 30;

/** The ids of a shared link: AliExpress product ids only, once each, in order, at most SHARED_MAX. */
export function parseSharedIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  const out: string[] = [];
  for (const id of raw.split(",")) {
    const v = id.trim();
    if (/^\d{6,20}$/.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= SHARED_MAX) break;
  }
  return out;
}

/** Our page of a shared list, absolute (it is sent in a message). */
export function sharedListUrl(ids: readonly string[]): string {
  return `https://${SITE_HOST}/shared?ids=${ids.slice(0, SHARED_MAX).join(",")}`;
}

/** Our page of one product, absolute. */
export function productUrl(id: string): string {
  return `https://${SITE_HOST}/p/${encodeURIComponent(id)}`;
}

/** A WhatsApp link that opens a chat with `text` (the person picks whom to send it to). */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
