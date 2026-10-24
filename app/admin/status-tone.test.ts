import { describe, expect, it } from "vitest";
import { statusTone } from "./status-tone";

describe("statusTone", () => {
  it("reads failures as errors", () => {
    for (const k of [
      "invalid",
      "failed",
      "save-failed",
      "publish-failed",
      "publish-not-connected",
      "publish-already",
      "not-editable",
      "no-media",
      "bad-link",
      "too-soon",
      "quiet",
      "tg-not-found",
      "tg-expired",
      "tg-not-configured",
    ]) {
      expect(statusTone(k), k).toBe("error");
    }
  });

  it("reads the rest as successes", () => {
    for (const k of [
      "saved",
      "scheduled-reel",
      "updated",
      "posted",
      "approved",
      "tg-linked",
      "approved-telegram-off",
      "rewritten",
    ]) {
      expect(statusTone(k), k).toBe("success");
    }
  });
});
