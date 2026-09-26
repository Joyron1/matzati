// The /sync gateway wraps arrays as { product: [...] } / { string: [...] }, while the docs show
// plain arrays. Accept both.
export function unwrapList(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    const inner = (value as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
    if (inner !== undefined && inner !== null) return [inner];
  }
  return [];
}
