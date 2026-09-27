import { describe, expect, it, vi } from "vitest";
import {
  AliExpressClient,
  buildParams,
  classifyGatewayError,
  parseEnvelope,
  parseJsonKeepingIds,
} from "./client";
import { AliExpressError } from "./errors";
import { signRequest } from "./sign";

const config = {
  appKey: "12345678",
  appSecret: "helloworld",
  trackingId: "test_tracking",
  gateway: "https://gateway.test/sync",
};

const okBody = (method: string, result: unknown) => ({
  [`${method.replaceAll(".", "_")}_response`]: {
    resp_result: { resp_code: 200, resp_msg: "success", result },
    request_id: "req-1",
  },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("buildParams", () => {
  it("adds system params, drops empty values, and signs exactly what it sends", () => {
    const fields = buildParams(
      config,
      "aliexpress.affiliate.product.query",
      { keywords: "usb cable", page_no: 1, category_ids: "", fields: undefined, sort: null },
      1517820392000,
    );
    expect(fields).toMatchObject({
      app_key: "12345678",
      method: "aliexpress.affiliate.product.query",
      sign_method: "sha256",
      timestamp: "1517820392000",
      keywords: "usb cable",
      page_no: "1",
    });
    expect(Object.keys(fields)).not.toContain("category_ids");
    expect(Object.keys(fields)).not.toContain("fields");
    const { sign, ...signed } = fields;
    expect(sign).toBe(signRequest("helloworld", signed, "aliexpress.affiliate.product.query"));
  });

  it("never includes the app secret in the request", () => {
    const fields = buildParams(config, "aliexpress.affiliate.category.get", {}, 1);
    expect(Object.values(fields)).not.toContain("helloworld");
  });
});

describe("parseEnvelope", () => {
  it("unwraps resp_result.result and the request id", () => {
    const res = parseEnvelope(
      "aliexpress.affiliate.category.get",
      okBody("aliexpress.affiliate.category.get", { a: 1 }),
    );
    expect(res.result).toEqual({ a: 1 });
    expect(res.requestId).toBe("req-1");
  });

  it("accepts string resp_code values", () => {
    const body = {
      aliexpress_affiliate_link_generate_response: {
        resp_result: { resp_code: "200", resp_msg: "success", result: { x: 1 } },
      },
    };
    expect(parseEnvelope("aliexpress.affiliate.link.generate", body).result).toEqual({ x: 1 });
  });

  it("maps resp_code 405 to no_results", () => {
    const body = {
      aliexpress_affiliate_product_query_response: {
        resp_result: { resp_code: 405, resp_msg: "The result is empty" },
      },
    };
    expect(() => parseEnvelope("aliexpress.affiliate.product.query", body)).toThrowError(
      expect.objectContaining({ kind: "no_results" }),
    );
  });

  it("maps gateway signature errors to auth", () => {
    const body = {
      error_response: {
        type: "ISV",
        code: "IncompleteSignature",
        msg: "The request signature does not conform to platform standards",
        request_id: "r",
      },
    };
    expect(() => parseEnvelope("aliexpress.affiliate.category.get", body)).toThrowError(
      expect.objectContaining({
        kind: "auth",
        details: expect.objectContaining({ code: "IncompleteSignature" }),
      }),
    );
  });

  it("rejects bodies without resp_result", () => {
    expect(() => parseEnvelope("m.x", { m_x_response: {} })).toThrowError(
      expect.objectContaining({ kind: "bad_response" }),
    );
  });
});

describe("parseJsonKeepingIds", () => {
  it("keeps ids beyond MAX_SAFE_INTEGER exact", () => {
    const text = '{"sku_id":12000059493652163,"product_id":1005012830143811,"lastest_volume":6}';
    expect(parseJsonKeepingIds(text)).toEqual({
      sku_id: "12000059493652163",
      product_id: "1005012830143811",
      lastest_volume: 6,
    });
  });
  it("leaves quoted ids, nested arrays and look-alikes inside strings alone", () => {
    const text =
      '{"request_id":"abc","list":[{"category_id":3}],"note":"x \\"a_id\\": 12, y","shop_id":7}';
    expect(parseJsonKeepingIds(text)).toEqual({
      request_id: "abc",
      list: [{ category_id: "3" }],
      note: 'x "a_id": 12, y',
      shop_id: "7",
    });
  });
});

describe("classifyGatewayError", () => {
  it("classifies by code, sub_code, then type", () => {
    expect(classifyGatewayError({ code: "ApiCallLimit" })).toBe("rate_limit");
    expect(
      classifyGatewayError({ code: "15", type: "ISP", sub_code: "isv.insufficient-permission" }),
    ).toBe("auth");
    expect(classifyGatewayError({ code: "MissingParameter" })).toBe("invalid_request");
    expect(classifyGatewayError({ code: "15", type: "ISP" })).toBe("server");
    expect(classifyGatewayError({ code: "weird" })).toBe("unknown");
  });
});

describe("AliExpressClient.call", () => {
  const method = "aliexpress.affiliate.category.get";
  const noSleep = vi.fn(async () => {});

  it("POSTs a signed form body to the gateway", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(okBody(method, { ok: true })));
    const client = new AliExpressClient(config, {
      fetch: fetchMock,
      now: () => 1000,
      sleep: noSleep,
    });
    const res = await client.call(method, { page_no: 1 });
    expect(res.result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.test/sync");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("method")).toBe(method);
    expect(body.get("timestamp")).toBe("1000");
    expect(body.get("sign")).toMatch(/^[0-9A-F]{64}$/);
  });

  it("retries network errors and 5xx twice with backoff, then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("oops", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(okBody(method, [])));
    const sleep = vi.fn(async () => {});
    const client = new AliExpressClient(config, { fetch: fetchMock, sleep });
    await expect(client.call(method)).resolves.toMatchObject({ result: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[400], [1200]]);
  });

  it("gives up after 2 retries with a network error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const client = new AliExpressClient(config, { fetch: fetchMock, sleep: noSleep });
    await expect(client.call(method)).rejects.toMatchObject({ kind: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits out a 1-second ApiCallLimit ban and retries", async () => {
    const ban = {
      error_response: {
        type: "ISV",
        code: "ApiCallLimit",
        msg: "Api access frequency exceeds the limit. this ban will last 1 seconds",
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(ban))
      .mockResolvedValueOnce(jsonResponse(okBody(method, [])));
    const sleep = vi.fn(async () => {});
    const client = new AliExpressClient(config, { fetch: fetchMock, sleep });
    await expect(client.call(method)).resolves.toMatchObject({ result: [] });
    expect(sleep.mock.calls).toEqual([[1200]]);
  });

  it("does not retry auth errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error_response: { type: "ISV", code: "IncompleteSignature" } }),
      );
    const client = new AliExpressClient(config, { fetch: fetchMock, sleep: noSleep });
    await expect(client.call(method)).rejects.toBeInstanceOf(AliExpressError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts the secret from transport error messages", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("boom helloworld boom"));
    const client = new AliExpressClient(config, { fetch: fetchMock, sleep: noSleep, retries: 0 });
    await expect(client.call(method)).rejects.toThrow("boom <redacted> boom");
  });

  it("surfaces the cause of Node fetch failures (e.g. DNS) and keeps it on the error", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND gateway.test"), {
      code: "ENOTFOUND",
    });
    const failure = new TypeError("fetch failed", { cause });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const client = new AliExpressClient(config, { fetch: fetchMock, sleep: noSleep, retries: 0 });
    const err = await client.call(method).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AliExpressError);
    expect((err as AliExpressError).kind).toBe("network");
    expect((err as Error).message).toContain("ENOTFOUND");
    expect((err as Error).cause).toBe(failure);
  });
});
