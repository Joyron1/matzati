// Committed fixtures must not hold a value from .env.local (CLAUDE.md §12). The scan needs
// .env.local, so it is skipped where there is none (Vercel, CI). Failures name the KEY and the
// file, never the value.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvFile, secretEnv } from "./mask";

const FIXTURES = "fixtures";
/** Shorter values (a 6-digit app key) occur by chance inside product ids. */
const MIN_LENGTH = 8;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? filesUnder(join(dir, d.name)) : d.isFile() ? [join(dir, d.name)] : [],
  );
}

const readIfExists = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

describe.skipIf(!existsSync(".env.local"))("fixtures hold no .env.local value", () => {
  it(`finds no secret of ${MIN_LENGTH}+ characters in ${FIXTURES}/**`, () => {
    const env = secretEnv(
      parseEnvFile(readFileSync(".env.local", "utf8")),
      parseEnvFile(readIfExists(".env.example")),
    );
    const secrets = Object.entries(env).filter(([, value]) => value.length >= MIN_LENGTH);
    const files = filesUnder(FIXTURES);
    expect(files.length).toBeGreaterThan(0);

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const [key, value] of secrets) {
        if (text.includes(value)) hits.push(`${key} in ${file}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("link.generate fixture", () => {
  it("keeps the tracking id masked", () => {
    const raw = JSON.parse(
      readFileSync(`${FIXTURES}/aliexpress/aliexpress.affiliate.link.generate.json`, "utf8"),
    );
    const trackingId =
      raw.aliexpress_affiliate_link_generate_response.resp_result.result.tracking_id;
    // A boolean, so a failure never prints the value it found (it may be the real tracking id).
    expect(
      trackingId === "<ALIEXPRESS_TRACKING_ID>",
      "link.generate fixture holds an unmasked tracking_id",
    ).toBe(true);
  });
});
