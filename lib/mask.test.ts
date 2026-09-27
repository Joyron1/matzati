import { describe, expect, it } from "vitest";
import {
  findEnvValues,
  maskEnvValues,
  maskEnvValuesDeep,
  maskSecret,
  parseEnvFile,
  redact,
  secretEnv,
} from "./mask";

describe("maskSecret", () => {
  it("keeps only two characters at each end", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("ab************op");
    expect(maskSecret("abcdefgh")).toBe("ab****gh");
  });
  it("fully masks short values and reports empty ones", () => {
    expect(maskSecret("abc")).toBe("***");
    expect(maskSecret("")).toBe("<empty>");
    expect(maskSecret(undefined)).toBe("<empty>");
  });
});

describe("redact", () => {
  it("removes every occurrence of each secret", () => {
    expect(redact("key=SECRET1&x=SECRET1&y=TOKEN", ["SECRET1", "TOKEN"])).toBe(
      "key=<redacted>&x=<redacted>&y=<redacted>",
    );
  });
  it("ignores empty and very short secrets", () => {
    expect(redact("abc", ["", undefined, "a"])).toBe("abc");
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=value lines and strips quotes and inline comments", () => {
    const text = [
      "# comment",
      "",
      "A=plain",
      "export B = spaced  ",
      'C="quoted # not a comment"',
      "D='single'",
      "E=value # trailing comment",
      "F=",
      "not a line",
    ].join("\r\n");
    expect(parseEnvFile(text)).toEqual({
      A: "plain",
      B: "spaced",
      C: "quoted # not a comment",
      D: "single",
      E: "value",
      F: "",
    });
  });
});

describe("secretEnv", () => {
  it("drops empty values and keys with a committed default in .env.example", () => {
    const local = { APP_SECRET: "s3cr3t-value", LLM_MODEL: "some-model-1", EMPTY: "" };
    const example = { APP_SECRET: "", LLM_MODEL: "claude-haiku-4-5-20251001" };
    expect(secretEnv(local, example)).toEqual({ APP_SECRET: "s3cr3t-value" });
    expect(secretEnv(local)).toEqual({ APP_SECRET: "s3cr3t-value", LLM_MODEL: "some-model-1" });
  });
});

describe("maskEnvValues", () => {
  const env = {
    TRACKING_ID: "matzati_track1",
    APP_KEY: "512345",
    SHORT: "abc12",
    UNSET: undefined,
  };

  it("replaces a long value wherever it occurs", () => {
    expect(maskEnvValues('{"tracking_id":"matzati_track1","x":"id=matzati_track1&y"}', env)).toBe(
      '{"tracking_id":"<TRACKING_ID>","x":"id=<TRACKING_ID>&y"}',
    );
  });

  it("replaces a 6-7 character value only as a standalone token", () => {
    expect(maskEnvValues("app_key=512345&x", env)).toBe("app_key=<APP_KEY>&x");
    expect(maskEnvValues("1005006512345917", env)).toBe("1005006512345917");
  });

  it("leaves values shorter than 6 characters alone", () => {
    expect(maskEnvValues("cap abc12", env)).toBe("cap abc12");
  });

  it("masks a value that contains another one as a whole", () => {
    const nested = { URL: "https://abcdefgh.example.co", REF: "abcdefgh" };
    expect(maskEnvValues("u=https://abcdefgh.example.co r=abcdefgh", nested)).toBe(
      "u=<URL> r=<REF>",
    );
  });

  it("treats regex characters and $ in values literally", () => {
    expect(maskEnvValues("k=a.b*c$&d(1)", { K: "a.b*c$&d(1)" })).toBe("k=<K>");
    expect(maskEnvValues("k=aXbYc$&d(1)", { K: "a.b*c$&d(1)" })).toBe("k=aXbYc$&d(1)");
  });
});

describe("maskEnvValuesDeep", () => {
  it("masks strings and numbers inside objects and arrays, keeping keys", () => {
    const env = { TRACKING_ID: "matzati_track1", APP_KEY: "512345" };
    expect(
      maskEnvValuesDeep(
        { tracking_id: "matzati_track1", n: 512345, id: 1005006512345917, ok: true, l: ["x"] },
        env,
      ),
    ).toEqual({
      tracking_id: "<TRACKING_ID>",
      n: "<APP_KEY>",
      id: 1005006512345917,
      ok: true,
      l: ["x"],
    });
  });
});

describe("findEnvValues", () => {
  const env = { TRACKING_ID: "matzati_track1", APP_KEY: "512345" };

  it("reports leaks and coincidental digits by key", () => {
    expect(findEnvValues("t=matzati_track1 id=1005006512345917", env)).toEqual({
      leaks: ["TRACKING_ID"],
      coincidental: ["APP_KEY"],
    });
  });

  it("finds nothing after masking", () => {
    const masked = maskEnvValues("t=matzati_track1 k=512345", env);
    expect(findEnvValues(masked, env)).toEqual({ leaks: [], coincidental: [] });
  });
});
