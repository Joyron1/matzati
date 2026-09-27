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

// ---------------------------------------------------------------- .env.local values

export type EnvValues = Record<string, string | undefined>;

/** Shorter values are never masked: flags and small numbers, not credentials. */
export const MIN_MASKED_ENV_LENGTH = 6;
/** Values this long are masked wherever they occur; shorter ones only as a standalone token. */
const MASK_ANYWHERE_LENGTH = 8;

/**
 * KEY -> value from dotenv text: `KEY=value` lines (optional `export`), surrounding quotes
 * stripped, ` # comment` dropped from unquoted values. No variable expansion.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    out[m[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "");
  }
  return out;
}

/**
 * The .env.local entries that may be secret: drops keys with a non-empty default in the committed
 * .env.example (ALIEXPRESS_GATEWAY, LLM_MODEL, DAILY_SEARCH_CAP, ...), which are public config.
 */
export function secretEnv(local: EnvValues, example: EnvValues = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(local)) {
    if (value && !example[key]) out[key] = value;
  }
  return out;
}

interface EnvMatcher {
  key: string;
  value: string;
  source: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest value first, so a value that contains another is masked whole. Short values (a 6-digit
// app key) match only as a standalone token, so they don't corrupt a longer product id that
// happens to contain the same digits.
function envMatchers(env: EnvValues): EnvMatcher[] {
  const entries = Object.entries(env)
    .filter((e): e is [string, string] => (e[1]?.length ?? 0) >= MIN_MASKED_ENV_LENGTH)
    .sort(([ka, a], [kb, b]) => b.length - a.length || ka.localeCompare(kb));
  const out: EnvMatcher[] = [];
  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (seen.has(value)) continue; // the same value under two keys: the first key names it
    seen.add(value);
    const escaped = escapeRe(value);
    out.push({
      key,
      value,
      source:
        value.length >= MASK_ANYWHERE_LENGTH
          ? escaped
          : `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`,
    });
  }
  return out;
}

/** Replaces every env value of 6+ characters in `text` with `<KEY>` (e.g. before saving a fixture). */
export function maskEnvValues(text: string, env: EnvValues): string {
  let out = text;
  for (const { key, source } of envMatchers(env)) {
    out = out.replace(new RegExp(source, "g"), () => `<${key}>`);
  }
  return out;
}

/** maskEnvValues over every string (and number or boolean) inside a parsed JSON value. */
export function maskEnvValuesDeep(value: unknown, env: EnvValues): unknown {
  if (typeof value === "string") return maskEnvValues(value, env);
  if (typeof value === "number" || typeof value === "boolean") {
    const masked = maskEnvValues(String(value), env);
    return masked === String(value) ? value : masked;
  }
  if (Array.isArray(value)) return value.map((v) => maskEnvValuesDeep(v, env));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maskEnvValuesDeep(v, env)]),
    );
  }
  return value;
}

/**
 * Keys whose value is still in `text`: `leaks` where maskEnvValues would have masked it,
 * `coincidental` where a short value occurs only inside a longer token.
 */
export function findEnvValues(
  text: string,
  env: EnvValues,
): { leaks: string[]; coincidental: string[] } {
  const leaks: string[] = [];
  const coincidental: string[] = [];
  for (const m of envMatchers(env)) {
    if (!text.includes(m.value)) continue;
    (new RegExp(m.source).test(text) ? leaks : coincidental).push(m.key);
  }
  return { leaks, coincidental };
}
