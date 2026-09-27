import { describe, expect, it } from "vitest";
import { extractNumbers, numbersAreGrounded, numbersIn } from "./numbers";

describe("extractNumbers", () => {
  it("normalizes thousands separators and decimals", () => {
    expect(extractNumbers("96.8% משוב חיובי ו־3,412 מכירות, עד ₪100")).toEqual([
      "96.8",
      "3412",
      "100",
    ]);
    expect(extractNumbers("IPX5, Bluetooth 5.3")).toEqual(["5", "5.3"]);
    expect(extractNumbers("בלי מספרים")).toEqual([]);
  });
});

describe("numbersIn", () => {
  it("reads numbers from values only, never from keys", () => {
    expect([...numbersIn({ units_sold_30d: 405, title_en: "IPX8 V5.4", id: null })]).toEqual([
      "405",
      "8",
      "5.4",
    ]);
    expect(numbersIn([{ price_ils: 18.4 }, 150, undefined]).has("18.4")).toBe(true);
  });
});

describe("numbersAreGrounded", () => {
  const data = { positive_feedback_pct: 96.8, units_sold_30d: 3412, max_price_ils: 100 };

  it("accepts numbers copied from the data, in any formatting", () => {
    expect(numbersAreGrounded("96.8% משוב חיובי ו־3,412 מכירות, בתקציב של ₪100", data)).toBe(true);
    expect(numbersAreGrounded("נמכר הכי הרבה מבין האפשרויות", data)).toBe(true);
  });

  it("rejects rounded or invented numbers", () => {
    expect(numbersAreGrounded("97% משוב חיובי", data)).toBe(false);
    expect(numbersAreGrounded("יותר מ־3,000 מכירות", data)).toBe(false);
    expect(numbersAreGrounded("אחריות לשנתיים, 2 שנים", data)).toBe(false);
  });

  it("always allows the 30-day sales window, unless the caller opts out", () => {
    const sold = "3,412 נמכרו ב־30 הימים האחרונים";
    expect(numbersAreGrounded(sold, data)).toBe(true);
    expect(numbersAreGrounded(sold, { units_sold_30d: 3412 }, [])).toBe(false);
    expect(numbersAreGrounded("מטען 30W", "65W GaN Charger", [])).toBe(false);
  });
});
