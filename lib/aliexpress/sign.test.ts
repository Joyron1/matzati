import { describe, expect, it } from "vitest";
import { signRequest, stringToSign } from "./sign";

describe("signRequest", () => {
  // Official vector: openservice.aliexpress.com docId 1385, "Case 1: Business Interfaces".
  it("matches the official business-interface example", () => {
    const params = {
      access_token: "test",
      aliexpress_category_id: "200135143",
      app_key: "123456",
      method: "aliexpress.logistics.redefining.getonlinelogisticsinfo",
      sign_method: "sha256",
      timestamp: "1517820392000",
    };
    expect(signRequest("helloworld", params, params.method)).toBe(
      "F7F7926B67316C9D1E8E15F7E66940ED3059B1638C497D77973F30046EFB5BBB",
    );
  });

  // Official vector for a /rest system interface, where the API path is prepended.
  it("prepends the API path only for path-style system interfaces", () => {
    const params = {
      app_key: "12345678",
      code: "3_500102_JxZ05Ux3cnnSSUm6dCxYg6Q26",
      sign_method: "sha256",
      timestamp: "1517820392000",
    };
    expect(stringToSign(params, "/auth/token/create")).toBe(
      "/auth/token/createapp_key12345678code3_500102_JxZ05Ux3cnnSSUm6dCxYg6Q26sign_methodsha256timestamp1517820392000",
    );
    expect(signRequest("helloworld", params, "/auth/token/create")).toBe(
      "35607762342831B6A417A0DED84B79C05FEFBF116969C48AD6DC00279A9F4D81",
    );
  });

  // Same algorithm run through the official iop-sdk-python sign() for an affiliate method.
  it("matches the official Python SDK for an affiliate call", () => {
    const params = {
      app_key: "12345678",
      method: "aliexpress.affiliate.category.get",
      sign_method: "sha256",
      timestamp: "1517820392000",
    };
    expect(stringToSign(params, params.method)).toBe(
      "app_key12345678methodaliexpress.affiliate.category.getsign_methodsha256timestamp1517820392000",
    );
    expect(signRequest("helloworld", params, params.method)).toBe(
      "F3ABBAB059750C3CD6D341A2FDA939ECB0FA892120E9196270ED67D6EC1511DD",
    );
  });
});

describe("stringToSign", () => {
  it("sorts keys in ASCII order, with '_' before lowercase letters", () => {
    expect(stringToSign({ foo: "1", bar: "2", foo_bar: "3", foobar: "4" })).toBe(
      "bar2foo1foo_bar3foobar4",
    );
  });
  it("excludes sign and empty values", () => {
    expect(stringToSign({ b: "2", sign: "XYZ", a: "", c: "3" })).toBe("b2c3");
  });
  it("signs raw values, not URL-encoded ones", () => {
    expect(stringToSign({ keywords: "usb cable", source_values: "https://a.b/c?d=1" })).toBe(
      "keywordsusb cablesource_valueshttps://a.b/c?d=1",
    );
  });
});
