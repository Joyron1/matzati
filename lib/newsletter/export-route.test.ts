// The admin's CSV export route (/admin/newsletter/export) with fakes: it checks requireAdmin()
// before reading anything, and answers with an uncached UTF-8 CSV attachment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/admin/newsletter/export/route";

const m = vi.hoisted(() => ({
  admin: true,
  reads: 0,
  fail: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: async () => {
    if (!m.admin) throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/admin/login" });
    return { email: "owner@example.com" };
  },
}));
vi.mock("@/lib/newsletter/admin", async () => {
  const { subscribersCsv, csvFileName } = await import("./csv");
  return {
    exportActiveSubscribers: async (now: Date) => {
      m.reads++;
      if (m.fail) throw new Error("newsletter list failed");
      const rows = [
        {
          email: "dana@example.com",
          consentedAt: "2026-09-28T20:00:00Z",
          source: "footer",
          consentVersion: "2026-09-28",
        },
      ];
      return { body: subscribersCsv(rows), fileName: csvFileName(now), rows: rows.length };
    },
  };
});

beforeEach(() => {
  m.admin = true;
  m.reads = 0;
  m.fail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /admin/newsletter/export", () => {
  it("sends the CSV to an admin, uncached, as an attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="matzati-newsletter-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain('"dana@example.com"');
  });

  it("reads nothing for anyone else (requireAdmin redirects first)", async () => {
    m.admin = false;
    await expect(GET()).rejects.toMatchObject({ url: "/admin/login" });
    expect(m.reads).toBe(0);
  });

  it("answers 503 without rows when the read fails", async () => {
    m.fail = true;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).not.toContain("@");
  });
});
