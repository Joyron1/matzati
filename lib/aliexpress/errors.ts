// Typed errors for the AliExpress Open Platform client.

export type AliExpressErrorKind =
  | "auth" // bad app key, signature, or permissions
  | "rate_limit" // call quota or frequency exceeded
  | "invalid_request" // missing/invalid parameters
  | "no_results" // business call succeeded but returned nothing
  | "server" // gateway 5xx or ISP-side failure
  | "network" // timeout, DNS, connection reset
  | "bad_response" // unparseable or unexpected JSON
  | "unknown";

export class AliExpressError extends Error {
  constructor(
    public readonly kind: AliExpressErrorKind,
    message: string,
    public readonly details: {
      method?: string;
      code?: string;
      requestId?: string;
      httpStatus?: number;
    } = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AliExpressError";
  }

  /** Worth retrying: transient transport or server problems only. */
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "server";
  }
}
