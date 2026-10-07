// Low-level AliExpress Open Platform client for /sync business APIs.
// Server-side only: it holds the app secret.
import type { AliExpressConfig } from "@/lib/env";
import { redact } from "@/lib/mask";
import { AliExpressError, type AliExpressErrorKind } from "./errors";
import { signRequest, type SignParams } from "./sign";

export type ParamValue = string | number | boolean | null | undefined;

export interface ClientDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
}

export interface CallResult {
  /** `resp_result.result` from the business envelope. */
  result: unknown;
  requestId: string | undefined;
  /** Full parsed body, for saving fixtures. */
  raw: unknown;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_MS = [400, 1_200];
const RATE_LIMIT_WAIT_MS = 1_200;

/** Signed form fields for one call. Empty values are dropped so what we sign is what we send. */
export function buildParams(
  config: Pick<AliExpressConfig, "appKey" | "appSecret">,
  method: string,
  params: Record<string, ParamValue>,
  timestampMs: number,
): SignParams {
  const all: SignParams = {
    app_key: config.appKey,
    method,
    sign_method: "sha256",
    timestamp: String(timestampMs),
  };
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const str = String(value);
    if (str.trim() === "") continue;
    all[key] = str;
  }
  all.sign = signRequest(config.appSecret, all, method);
  return all;
}

// Gateway codes seen on AE/IOP. Unknown codes fall through to "unknown".
const AUTH_CODES = new Set([
  "IncompleteSignature",
  "InvalidAppKey",
  "AppKeyNotExist",
  "InvalidSignature",
  "AppWhiteIpLimit",
  "InsufficientPermission",
  "isv.insufficient-permission",
]);
const RATE_CODES = new Set(["ApiCallLimit", "AppCallLimit", "7", "isv.api-call-limit"]);
const PARAM_CODES = new Set(["MissingParameter", "InvalidParameter", "40", "41"]);

export function classifyGatewayError(err: {
  type?: string;
  code?: string;
  sub_code?: string;
}): AliExpressErrorKind {
  const codes = [err.code, err.sub_code].filter((c): c is string => Boolean(c));
  if (codes.some((c) => AUTH_CODES.has(c))) return "auth";
  if (codes.some((c) => RATE_CODES.has(c))) return "rate_limit";
  if (codes.some((c) => PARAM_CODES.has(c))) return "invalid_request";
  if (err.type === "ISP" || err.type === "SYSTEM") return "server";
  return "unknown";
}

// IDs such as sku_id (17 digits) exceed Number.MAX_SAFE_INTEGER, so JSON.parse would round them.
// Quote numeric values of id fields before parsing so they survive as exact strings.
const ID_FIELD = /("[a-z_]*_id"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g;

export function parseJsonKeepingIds(text: string): unknown {
  return JSON.parse(text.replace(ID_FIELD, '$1"$2"'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwraps `<method>_response.resp_result` and raises typed errors for failures. */
export function parseEnvelope(method: string, body: unknown): CallResult {
  if (!isRecord(body)) {
    throw new AliExpressError("bad_response", "Response is not a JSON object", { method });
  }

  const gatewayError = body.error_response;
  if (isRecord(gatewayError)) {
    const e = gatewayError as Record<string, string | undefined>;
    const kind = classifyGatewayError(e);
    const text = [e.code, e.msg ?? e.message, e.sub_code, e.sub_msg].filter(Boolean).join(" | ");
    throw new AliExpressError(kind, `AliExpress gateway error: ${text}`, {
      method,
      code: e.sub_code ?? e.code,
      requestId: e.request_id,
    });
  }

  const envelopeKey = `${method.replaceAll(".", "_")}_response`;
  const envelope = isRecord(body[envelopeKey]) ? body[envelopeKey] : body; // simplified form has no wrapper
  const requestId =
    (typeof envelope.request_id === "string" && envelope.request_id) ||
    (typeof body.request_id === "string" && body.request_id) ||
    undefined;
  const respResult = envelope.resp_result;
  if (!isRecord(respResult)) {
    throw new AliExpressError("bad_response", `Missing resp_result in ${envelopeKey}`, {
      method,
      requestId,
    });
  }

  const code = Number(respResult.resp_code);
  if (code !== 200) {
    const msg = String(respResult.resp_msg ?? "");
    const kind: AliExpressErrorKind = code === 405 ? "no_results" : "invalid_request";
    throw new AliExpressError(kind, `AliExpress resp_code ${code}: ${msg}`, {
      method,
      code: String(code),
      requestId,
    });
  }

  return { result: respResult.result, requestId, raw: body };
}

export class AliExpressClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    private readonly config: AliExpressConfig,
    deps: ClientDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = deps.retries ?? DEFAULT_RETRIES;
  }

  get trackingId(): string {
    return this.config.trackingId;
  }

  async call(method: string, params: Record<string, ParamValue> = {}): Promise<CallResult> {
    let lastError: AliExpressError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const backoff = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)!;
        // A frequency ban lasts about a second, so wait it out before retrying.
        await this.sleep(
          lastError?.kind === "rate_limit" ? Math.max(backoff, RATE_LIMIT_WAIT_MS) : backoff,
        );
      }
      try {
        return parseEnvelope(method, await this.send(method, params));
      } catch (err) {
        const error = this.toError(err, method);
        if (!error.retryable) throw error;
        lastError = error;
      }
    }
    throw lastError!;
  }

  private async send(method: string, params: Record<string, ParamValue>): Promise<unknown> {
    const fields = buildParams(this.config, method, params, this.now());
    const response = await this.fetchImpl(this.config.gateway, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
      // No `cache: "no-store"`: Next caches a fetch only when asked to (the fetch docs in
      // node_modules/next), and "no-store" makes a cached page dynamic at run time: /p is cached a
      // day and refreshes its product here, and its first visit failed with "Page changed from
      // static to dynamic" (2026-10-08).
    });
    if (response.status >= 500) {
      throw new AliExpressError("server", `AliExpress HTTP ${response.status}`, {
        method,
        httpStatus: response.status,
      });
    }
    const text = await response.text();
    try {
      return parseJsonKeepingIds(text);
    } catch {
      throw new AliExpressError(
        "bad_response",
        `AliExpress HTTP ${response.status}: body is not JSON`,
        { method, httpStatus: response.status },
      );
    }
  }

  private toError(err: unknown, method: string): AliExpressError {
    if (err instanceof AliExpressError) return err;
    // Node's fetch rejects with "fetch failed"; the real reason (ENOTFOUND, ECONNREFUSED, a TLS
    // error, a timeout) lives on err.cause, so include it.
    const cause = err instanceof Error ? err.cause : undefined;
    const causeText =
      cause instanceof Error
        ? ` (${[(cause as NodeJS.ErrnoException).code, cause.message].filter(Boolean).join(": ")})`
        : "";
    const base = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const message = redact(`${base}${causeText}`, [this.config.appSecret]);
    return new AliExpressError(
      "network",
      `AliExpress request failed: ${message}`,
      { method },
      { cause: err },
    );
  }
}
