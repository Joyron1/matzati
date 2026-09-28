import { describe, expect, it, vi } from "vitest";
import { retryOnce } from "./retry";

type Run = { ok: true } | { ok: false; error: string };

const upstream: Run = { ok: false, error: "upstream" };
const opts = (over: Partial<Parameters<typeof retryOnce<Run>>[1]> = {}) => ({
  retryable: (r: Run) => !r.ok && r.error === "upstream",
  backoffMs: 3_000,
  roomMs: 25_000,
  deadline: 100_000,
  now: () => 10_000,
  sleep: vi.fn(async () => {}),
  ...over,
});

describe("retryOnce", () => {
  it("tries an upstream failure once more after the back-off", async () => {
    const attempt = vi
      .fn<() => Promise<Run>>()
      .mockResolvedValueOnce(upstream)
      .mockResolvedValueOnce({ ok: true });
    const o = opts();
    expect(await retryOnce(attempt, o)).toEqual({ ok: true });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(o.sleep).toHaveBeenCalledWith(3_000);
  });

  it("tries only once more, and never for other results", async () => {
    const failing = vi.fn<() => Promise<Run>>(async () => upstream);
    expect(await retryOnce(failing, opts())).toEqual(upstream);
    expect(failing).toHaveBeenCalledTimes(2);
    const llm = vi.fn<() => Promise<Run>>(async () => ({ ok: false, error: "llm" }));
    expect(await retryOnce(llm, opts())).toEqual({ ok: false, error: "llm" });
    expect(llm).toHaveBeenCalledTimes(1);
    const fine = vi.fn<() => Promise<Run>>(async () => ({ ok: true }));
    await retryOnce(fine, opts());
    expect(fine).toHaveBeenCalledTimes(1);
  });

  it("does not start a retry that could run past the deadline", async () => {
    const attempt = vi.fn<() => Promise<Run>>(async () => upstream);
    const o = opts({ now: () => 100_000 - 25_000 - 3_000 + 1 });
    expect(await retryOnce(attempt, o)).toEqual(upstream);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(o.sleep).not.toHaveBeenCalled();
  });
});
