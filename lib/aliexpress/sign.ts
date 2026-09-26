// AliExpress Open Platform request signing (sign_method=sha256).
// Verified against the official doc vector (docId 1385, "Case 1: Business Interfaces") and the
// official iop-sdk-python sign(): sort params by key (code-point order), concatenate key+value
// with no separators, HMAC-SHA256 with the app secret, uppercase hex. `sign` itself and empty
// values are excluded. Business APIs on /sync get no prefix; only /rest system APIs whose name
// contains "/" get the API path prepended.
import { createHmac } from "node:crypto";

export type SignParams = Record<string, string>;

export function stringToSign(params: SignParams, apiName = ""): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== "")
    .sort(); // default sort compares UTF-16 code units: ASCII order for ASCII keys
  const prefix = apiName.includes("/") ? apiName : "";
  return prefix + keys.map((k) => `${k}${params[k]}`).join("");
}

export function signRequest(secret: string, params: SignParams, apiName = ""): string {
  return createHmac("sha256", secret)
    .update(stringToSign(params, apiName), "utf8")
    .digest("hex")
    .toUpperCase();
}
