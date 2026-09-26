/** "ab********yz" style masking, to show a secret is set without revealing it. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "<empty>";
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

/** Replaces every occurrence of the given secrets inside a string (e.g. an error message or URL). */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("<redacted>");
  }
  return out;
}
