import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));

const { chatWithCode } = await import("./owner");

const since = new Date("2026-10-24T12:00:00Z");
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("chatWithCode", () => {
  it("finds the private chat that sent exactly the code after it was made", () => {
    const updates = [
      {
        message: {
          date: at("2026-10-24T12:05:00Z"),
          text: "MZ123456",
          chat: { id: 42, type: "private" },
        },
      },
    ];
    expect(chatWithCode(updates, "MZ123456", since)).toBe("42");
  });

  it("ignores groups, other text and messages sent before the code", () => {
    const updates = [
      {
        message: {
          date: at("2026-10-24T12:05:00Z"),
          text: "MZ123456",
          chat: { id: 1, type: "group" },
        },
      },
      {
        message: {
          date: at("2026-10-24T12:05:00Z"),
          text: "hi MZ123456",
          chat: { id: 2, type: "private" },
        },
      },
      {
        message: {
          date: at("2026-10-24T11:00:00Z"),
          text: "MZ123456",
          chat: { id: 3, type: "private" },
        },
      },
    ];
    expect(chatWithCode(updates, "MZ123456", since)).toBeNull();
  });
});
