import { describe, expect, it } from "vitest";
import { loadLabels, reportJson, reportPath } from "./files";
import { CURRENT_POLICY } from "./policies";
import { newReport, runVariant } from "./report";
import { BOTTLE, call, good, snapshot, times } from "./testing";

describe("reportJson", () => {
  it("round-trips a report, with one product per line", () => {
    const snap = snapshot([
      call(
        "primary-p1",
        BOTTLE.keywords_en,
        1,
        times(4, () => good()),
      ),
    ]);
    const run = runVariant([snap], new Map(), { name: "current", policy: CURRENT_POLICY });
    const report = newReport("t", [snap], { files: [], queries: 0, entries: 0 }, [run]);
    const text = reportJson(report);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(report)));
    const line = text.split("\n").find((l) => l.includes(snap.calls[0].products[0].productId))!;
    expect(line.trim()).toMatch(/^\{"id":.*"title":.*\},?$/);
  });
});

describe("reportPath", () => {
  it("accepts plain names and rejects paths", () => {
    expect(reportPath("baseline-r5", "dir")).toBe("dir/report-baseline-r5.json");
    expect(() => reportPath("../x")).toThrow(/report name/);
    expect(() => reportPath("")).toThrow(/report name/);
  });
});

describe("loadLabels", () => {
  it("is empty when there is no labels directory", () => {
    expect(loadLabels("fixtures/snapshots/no-such-dir")).toEqual({
      book: new Map(),
      files: [],
      entries: 0,
    });
  });
});
