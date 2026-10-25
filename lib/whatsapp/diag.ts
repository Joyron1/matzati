// What happened to the WhatsApp webhook's last calls (2026-10-25: the bot answered nothing and no
// message was ever handled; the owner cannot open Vercel's logs). Each POST is recorded in
// site_settings ("whatsapp_diag", service role only, the last 15): a bad signature (the app secret
// is wrong), a payload for another phone number id (WHATSAPP_PHONE_NUMBER_ID is wrong; the ids are
// Meta's public number ids, not secrets), a delivery without messages (statuses), messages handed
// to the bot, or a send that Meta refused (its error message, which never holds the token).
// /admin/settings?tab=whatsapp shows them. Never a phone number, a message text or a secret.
import "server-only";
import { serviceClient } from "@/lib/supabase/server";

const KEY = "whatsapp_diag";
const KEEP = 15;
/** Bad signatures are recorded at most once a minute (anyone can POST to the webhook). */
const BAD_SIGNATURE_GAP_MS = 60_000;

export type DiagKind = "bad_signature" | "other_number" | "no_messages" | "received" | "send_error";

export interface DiagEvent {
  at: string;
  kind: DiagKind;
  /** Phone number ids the payload was for (other_number, no_messages). */
  numberIds?: string[];
  /** The changes' fields ("messages", ...). */
  fields?: string[];
  count?: number;
  error?: string;
}

export async function readDiag(): Promise<DiagEvent[]> {
  const { data } = await serviceClient()
    .from("site_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  const v = data?.value as { events?: DiagEvent[] } | null;
  return Array.isArray(v?.events) ? v.events : [];
}

export async function recordDiag(event: Omit<DiagEvent, "at">): Promise<void> {
  try {
    const events = await readDiag();
    const now = Date.now();
    if (
      event.kind === "bad_signature" &&
      events.some(
        (e) => e.kind === "bad_signature" && now - Date.parse(e.at) < BAD_SIGNATURE_GAP_MS,
      )
    ) {
      return;
    }
    const next = [{ ...event, at: new Date(now).toISOString() }, ...events].slice(0, KEEP);
    await serviceClient()
      .from("site_settings")
      .upsert({ key: KEY, value: { events: next } }, { onConflict: "key" });
  } catch {
    // A diagnostic must never break the webhook.
  }
}

/** The payload's number ids and change fields, whatever they are (for "other_number"). */
export function payloadSummary(payload: unknown): { numberIds: string[]; fields: string[] } {
  const numberIds = new Set<string>();
  const fields = new Set<string>();
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const changes = (entry as { changes?: unknown[] }).changes;
    for (const change of Array.isArray(changes) ? changes : []) {
      const c = change as { field?: unknown; value?: { metadata?: { phone_number_id?: unknown } } };
      if (typeof c.field === "string") fields.add(c.field.slice(0, 40));
      const id = c.value?.metadata?.phone_number_id;
      if (typeof id === "string" && /^\d{5,20}$/.test(id)) numberIds.add(id);
    }
  }
  return { numberIds: [...numberIds], fields: [...fields] };
}
