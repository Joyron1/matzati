// A thin client for the WhatsApp Cloud API (Graph API): send a message, and mark one read with the
// typing indicator. Plain fetch, no SDK. The access token is only ever put in the Authorization
// header: it is never logged and never part of an error message.
import type { WhatsAppConfig } from "./config";
import type { WaMessage } from "./messages";

export class WhatsAppApiError extends Error {
  constructor(
    readonly status: number,
    /** Meta's error code (error.code), when the body had one. */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const TIMEOUT_MS = 10_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface WhatsAppSender {
  /** Sends `message` to `to` (a wa_id); `replyTo` quotes one of the user's messages. */
  send(to: string, message: WaMessage, replyTo?: string): Promise<void>;
  /** Marks the user's message read and shows "typing…" until the next reply (max 25 s). */
  markReadTyping(messageId: string): Promise<void>;
}

export class WhatsAppClient implements WhatsAppSender {
  constructor(
    private readonly config: Pick<WhatsAppConfig, "accessToken" | "phoneNumberId" | "graphVersion">,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async post(body: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${this.config.graphVersion}/${this.config.phoneNumberId}/messages`;
    let lastError: WhatsAppApiError | null = null;
    // One retry on a rate limit or a server error; a 4xx is a bug in our message and is not retried.
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        lastError = new WhatsAppApiError(0, null, "network error or timeout");
        continue;
      }
      if (res.ok) return;
      const detail = await res
        .json()
        .then((j: { error?: { code?: number; message?: string } }) => j.error)
        .catch(() => undefined);
      lastError = new WhatsAppApiError(
        res.status,
        detail?.code ?? null,
        `Graph API ${res.status}${detail?.code ? ` (code ${detail.code})` : ""}: ${(detail?.message ?? "").slice(0, 200)}`,
      );
      if (!RETRY_STATUSES.has(res.status)) break;
    }
    throw lastError ?? new WhatsAppApiError(0, null, "unknown error");
  }

  async send(to: string, message: WaMessage, replyTo?: string): Promise<void> {
    await this.post({
      recipient_type: "individual",
      to,
      ...(replyTo ? { context: { message_id: replyTo } } : {}),
      ...message,
    });
  }

  async markReadTyping(messageId: string): Promise<void> {
    await this.post({
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    });
  }
}
