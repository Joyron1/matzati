// What Meta posts to the webhook, validated with zod, reduced to the messages the bot answers.
// Status updates (sent, delivered, read) and other fields are ignored.
import { z } from "zod";

const messageSchema = z.object({
  from: z.string().regex(/^\d{5,20}$/),
  id: z.string().min(1).max(200),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
    })
    .optional(),
});

const payloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            // One bad message must not drop its neighbours: each is checked on its own below.
            messages: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});

/** One message from a user, in the shape the bot routes on. */
export type Inbound =
  | { kind: "text"; id: string; from: string; text: string }
  | { kind: "action"; id: string; from: string; actionId: string }
  /** Voice notes, photos, stickers, locations, contacts, documents, reactions... */
  | { kind: "unsupported"; id: string; from: string };

/**
 * The user messages of one webhook POST addressed to `phoneNumberId`. Returns [] for anything that
 * is not a WhatsApp messages notification (the caller still answers 200, so Meta does not retry).
 */
export function inboundMessages(payload: unknown, phoneNumberId: string): Inbound[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return [];
  const out: Inbound[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      if (change.value.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const raw of change.value.messages ?? []) {
        const message = messageSchema.safeParse(raw);
        if (!message.success) continue;
        const m = message.data;
        if (m.type === "text" && m.text) {
          out.push({ kind: "text", id: m.id, from: m.from, text: m.text.body });
          continue;
        }
        const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
        if (m.type === "interactive" && reply) {
          out.push({ kind: "action", id: m.id, from: m.from, actionId: reply.id });
          continue;
        }
        out.push({ kind: "unsupported", id: m.id, from: m.from });
      }
    }
  }
  return out;
}
