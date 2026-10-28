import { describe, expect, it } from "vitest";
import {
  isQuietTime,
  israelParts,
  israelTime,
  nextSlot,
  queueEndSlot,
  slotLabel,
} from "./schedule";

// 2026-10-23 is a Friday; Israel is UTC+3 until 2026-10-25 (then UTC+2).
describe("agent schedule", () => {
  it("reads and builds Israel times across the DST change", () => {
    expect(israelTime(2026, 10, 22, 20, 0).toISOString()).toBe("2026-10-22T17:00:00.000Z");
    expect(israelTime(2026, 10, 27, 20, 0).toISOString()).toBe("2026-10-27T18:00:00.000Z");
    expect(israelParts(new Date("2026-10-23T14:00:00Z"))).toMatchObject({ weekday: 5, hour: 17 });
  });

  it("is quiet from Friday 17:00 to Saturday 19:30", () => {
    expect(isQuietTime(israelTime(2026, 10, 23, 16, 59))).toBe(false);
    expect(isQuietTime(israelTime(2026, 10, 23, 17, 0))).toBe(true);
    expect(isQuietTime(israelTime(2026, 10, 24, 19, 29))).toBe(true);
    expect(isQuietTime(israelTime(2026, 10, 24, 19, 30))).toBe(false);
    expect(isQuietTime(israelTime(2026, 10, 25, 10, 0))).toBe(false);
  });

  it("gives the next free slot, never in the quiet time, never twice", () => {
    // Friday 16:00: 15:00 passed and 20:00 is quiet; Saturday's 10:00 and 15:00 too; Saturday
    // 20:00 is the first.
    const friday = israelTime(2026, 10, 23, 16, 0);
    const first = nextSlot(friday, []);
    expect(first && slotLabel(first)).toBe("יום ש׳ 20:00, 24.10");
    const second = nextSlot(friday, [first!]);
    expect(second && slotLabel(second)).toBe("יום א׳ 10:00, 25.10");
  });

  it("leaves time to look again before a slot", () => {
    const at = nextSlot(israelTime(2026, 10, 26, 9, 55), []);
    expect(at && slotLabel(at)).toBe("יום ב׳ 15:00, 26.10");
  });

  it("puts a new post after every scheduled one, never into an earlier gap", () => {
    const now = israelTime(2026, 10, 27, 9, 0);
    const scheduled = [israelTime(2026, 10, 27, 15, 0), israelTime(2026, 10, 28, 20, 0)];
    // Today 10:00 and 20:00 are free, but the queue ends on Wednesday 20:00.
    const at = queueEndSlot(now, scheduled);
    expect(at && slotLabel(at)).toBe("יום ה׳ 10:00, 29.10");
    // An empty queue: the next free slot.
    const first = queueEndSlot(now, []);
    expect(first && slotLabel(first)).toBe("יום ג׳ 10:00, 27.10");
  });
});
