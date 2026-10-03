import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

type Rule = {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
};
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

/** Google's rule: the longest matching path wins, Allow on a tie. */
function allowed(rule: Rule, path: string): boolean {
  const match = (paths: string[]) =>
    Math.max(-1, ...paths.filter((p) => path.startsWith(p)).map((p) => p.length));
  return match(list(rule.allow)) >= match(list(rule.disallow));
}

describe("robots.txt", () => {
  const out = robots();
  const rules = (Array.isArray(out.rules) ? out.rules : [out.rules]) as Rule[];

  it("welcomes the AI crawlers by name with the same rules as everyone", () => {
    const named = rules.find((r) => list(r.userAgent).includes("GPTBot"))!;
    const all = rules.find((r) => list(r.userAgent).includes("*"))!;
    for (const ua of [
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Google-Extended",
      "Applebot-Extended",
      "Bingbot",
    ]) {
      expect(list(named.userAgent)).toContain(ua);
    }
    expect(named.allow).toEqual(all.allow);
    expect(named.disallow).toEqual(all.disallow);
    expect(out.sitemap).toBe("https://www.matzati-il.com/sitemap.xml");
  });

  it("opens the content pages and keeps every crawler out of the paid search and private paths", () => {
    for (const rule of rules) {
      for (const path of [
        "/",
        "/hot",
        "/hot?cat=44",
        "/s/x",
        "/p/1",
        "/coupons",
        "/sales",
        "/deals",
        "/searches",
        "/searches?cat=44",
        "/terms",
        "/privacy",
        "/llms.txt",
        "/sitemap.xml",
      ]) {
        expect(allowed(rule, path), path).toBe(true);
      }
      for (const path of [
        "/search",
        "/search?q=x",
        "/api/search",
        "/go/1",
        "/admin",
        "/admin/seo",
        "/dev/preview",
      ]) {
        expect(allowed(rule, path), path).toBe(false);
      }
    }
  });
});
