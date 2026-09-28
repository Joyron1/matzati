import { describe, expect, it } from "vitest";
import { deployEnv } from "./env";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("deployEnv", () => {
  it("reads VERCEL_ENV", () => {
    expect(deployEnv(env({ VERCEL_ENV: "production" }))).toBe("production");
    expect(deployEnv(env({ VERCEL_ENV: "preview" }))).toBe("preview");
    expect(deployEnv(env({ VERCEL_ENV: " development " }))).toBe("development");
  });

  it("is development when VERCEL_ENV is absent or unknown, never production by accident", () => {
    expect(deployEnv(env({}))).toBe("development");
    expect(deployEnv(env({ VERCEL_ENV: "" }))).toBe("development");
    expect(deployEnv(env({ VERCEL_ENV: "Production" }))).toBe("development");
    expect(deployEnv(env({ VERCEL: "1" }))).toBe("development");
  });
});
