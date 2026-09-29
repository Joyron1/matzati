import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@/lib/env";
import { whatsappConfig, whatsappEnabled } from "./config";
import { inboundMessages } from "./inbound";
import { actionId, parseActionId, parseText } from "./intent";
import { verifySignature } from "./signature";

const SECRET = "app-secret-for-tests";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("verifySignature", () => {
  const body = '{"object":"whatsapp_business_account"}';
  it("accepts the right signature", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects a changed body, a wrong key, a missing or malformed header", () => {
    expect(verifySignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), "another-secret-1")).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).replace("sha256=", ""), SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=zz", SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=", SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });
  it("checks the bytes of a Hebrew body", () => {
    const he = '{"text":"אוזניות לריצה"}';
    expect(verifySignature(he, sign(he), SECRET)).toBe(true);
  });
});

describe("whatsappConfig", () => {
  const env = {
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "106540352242922",
    WHATSAPP_VERIFY_TOKEN: "verify-token-1",
    WHATSAPP_APP_SECRET: SECRET,
  } as unknown as NodeJS.ProcessEnv;
  it("reads the settings and defaults the Graph version", () => {
    expect(whatsappConfig(env).graphVersion).toBe("v25.0");
    expect(whatsappEnabled(env)).toBe(true);
  });
  it("is off, and names only the missing keys, without them", () => {
    const rest = { ...env };
    delete rest.WHATSAPP_APP_SECRET;
    expect(whatsappEnabled(rest as NodeJS.ProcessEnv)).toBe(false);
    expect(() => whatsappConfig(rest as NodeJS.ProcessEnv)).toThrow(ConfigError);
    try {
      whatsappConfig({ ...rest, WHATSAPP_ACCESS_TOKEN: "super-secret-token" } as NodeJS.ProcessEnv);
    } catch (err) {
      expect((err as Error).message).toContain("WHATSAPP_APP_SECRET");
      expect((err as Error).message).not.toContain("super-secret-token");
    }
  });
});

const wrap = (messages: unknown[], phoneNumberId = "111") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "1",
      changes: [
        { field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, messages } },
      ],
    },
  ],
});

describe("inboundMessages", () => {
  it("reads text, button replies and list replies", () => {
    const out = inboundMessages(
      wrap([
        { from: "972501234567", id: "wamid.1", type: "text", text: { body: "אוזניות" } },
        {
          from: "972501234567",
          id: "wamid.2",
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "more", title: "עוד" } },
        },
        {
          from: "972501234567",
          id: "wamid.3",
          type: "interactive",
          interactive: { type: "list_reply", list_reply: { id: "drop:max", title: "בלי" } },
        },
      ]),
      "111",
    );
    expect(out).toEqual([
      { kind: "text", id: "wamid.1", from: "972501234567", text: "אוזניות" },
      { kind: "action", id: "wamid.2", from: "972501234567", actionId: "more" },
      { kind: "action", id: "wamid.3", from: "972501234567", actionId: "drop:max" },
    ]);
  });
  it("marks voice notes, photos and the like as unsupported", () => {
    const out = inboundMessages(
      wrap([{ from: "972501234567", id: "wamid.4", type: "audio", audio: { id: "x" } }]),
      "111",
    );
    expect(out).toEqual([{ kind: "unsupported", id: "wamid.4", from: "972501234567" }]);
  });
  it("ignores other numbers, status updates and junk, and keeps the good neighbours", () => {
    expect(
      inboundMessages(
        wrap([{ from: "972501234567", id: "a", type: "text", text: { body: "x" } }], "999"),
        "111",
      ),
    ).toEqual([]);
    expect(inboundMessages({ object: "page", entry: [] }, "111")).toEqual([]);
    expect(inboundMessages("nope", "111")).toEqual([]);
    expect(
      inboundMessages(
        {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: { metadata: { phone_number_id: "111" }, statuses: [{ id: "s" }] },
                },
              ],
            },
          ],
        },
        "111",
      ),
    ).toEqual([]);
    const mixed = inboundMessages(
      wrap([
        { bad: true },
        { from: "972501234567", id: "ok", type: "text", text: { body: "היי" } },
      ]),
      "111",
    );
    expect(mixed).toHaveLength(1);
  });
});

describe("parseText", () => {
  const action = (t: string) => {
    const i = parseText(t);
    return i.kind === "action" ? i.action.type : i.kind;
  };
  it("reads whole-message commands, ignoring case, niqqud and punctuation", () => {
    expect(action("תפריט")).toBe("menu");
    expect(action("היי!")).toBe("menu");
    expect(action("  שלום  ")).toBe("menu");
    expect(action("Hi")).toBe("menu");
    expect(action("מוצרים חמים")).toBe("hot");
    expect(action("קופונים?")).toBe("coupons");
    expect(action("מבצעים")).toBe("sales");
    expect(action("עוד")).toBe("more");
    expect(action("עוד 5")).toBe("more");
    expect(action("STOP")).toBe("stop");
    expect(action("עצור")).toBe("stop");
    expect(action("עזרה")).toBe("help");
  });
  it("ignores niqqud", () => {
    expect(action("תַּפְרִיט")).toBe("menu");
    expect(action("קוּפּוֹנִים")).toBe("coupons");
  });
  it("treats an empty message as the menu", () => {
    expect(action("   ")).toBe("menu");
    expect(action("?!")).toBe("menu");
  });
  it("searches for anything else, even when it starts with a command word", () => {
    expect(parseText("קופון לאייפון")).toEqual({ kind: "search", q: "קופון לאייפון" });
    expect(parseText("עוד אוזניות לריצה")).toEqual({ kind: "search", q: "עוד אוזניות לריצה" });
    expect(parseText("  שעון   חכם ")).toEqual({ kind: "search", q: "שעון חכם" });
  });
  it("refuses a query longer than the site's limit", () => {
    expect(parseText("א".repeat(201))).toEqual({ kind: "too_long" });
    expect(parseText("א".repeat(200)).kind).toBe("search");
  });
});

describe("action ids", () => {
  it("round-trips every action", () => {
    for (const a of [
      { type: "menu" },
      { type: "help" },
      { type: "hot" },
      { type: "coupons" },
      { type: "sales" },
      { type: "stop" },
      { type: "more" },
      { type: "sort", sort: "cheapest" },
      { type: "sort", sort: "most_popular" },
      { type: "drop", chipId: "max" },
      { type: "drop", chipId: "req:0" },
    ] as const) {
      expect(parseActionId(actionId(a))).toEqual(a);
    }
  });
  it("rejects ids we never sent", () => {
    for (const id of ["", "boom", "sort:free", "drop:", "drop:<script>", "MORE", "more "]) {
      expect(parseActionId(id)).toBeNull();
    }
  });
});
