// The "חיבור ל־Meta" extraction: whatever the owner pastes, only a valid Meta Pixel id comes out,
// and nothing else of the pasted text (no advanced matching data, no script).
import { describe, expect, it } from "vitest";
import {
  extractPixelId,
  META_EXTRACT_ERRORS,
  META_FIELD_MAX,
  META_PIXEL_FIELD,
  META_PIXEL_ID_PATTERN,
  metaPixelValueSchema,
  parseMetaForm,
  pixelIdOf,
} from "./meta";

const ID = "1234567890123456";

// Meta's base code as Events Manager gives it.
const BASE_CODE = `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${ID}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${ID}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;

describe("extractPixelId", () => {
  it("finds the id in Meta's whole base code (named twice) and alone", () => {
    expect(extractPixelId(BASE_CODE)).toEqual({ kind: "found", value: ID });
    expect(extractPixelId(ID)).toEqual({ kind: "found", value: ID });
    expect(extractPixelId(`  '${ID}'\n`)).toEqual({ kind: "found", value: ID });
    expect(extractPixelId(`fbq("init", "${ID}");`)).toEqual({ kind: "found", value: ID });
    expect(extractPixelId("1234 5678 9012 3456")).toEqual({ kind: "found", value: ID });
  });

  it("takes only the id from an init call with advanced matching data", () => {
    const pasted = `fbq('init', '${ID}', {em: 'someone@example.com', ph: '0501234567'});`;
    expect(extractPixelId(pasted)).toEqual({ kind: "found", value: ID });
  });

  it("is empty for an empty field (the connection is removed)", () => {
    expect(extractPixelId("")).toEqual({ kind: "empty" });
    expect(extractPixelId("  \n ")).toEqual({ kind: "empty" });
  });

  it("refuses two different ids, and says which", () => {
    const other = "9876543210987654";
    expect(extractPixelId(`${BASE_CODE}\nfbq('init', '${other}');`)).toEqual({
      kind: "error",
      message: META_EXTRACT_ERRORS.many([ID, other]),
    });
  });

  it("takes nothing that is not a whole id", () => {
    for (const text of [
      "123456789",
      "123456789012345678901",
      "G-AB12CD34EF",
      "abc1234567890",
      "fbq('init', '12345')",
    ]) {
      expect(extractPixelId(text)).toEqual({
        kind: "error",
        message: META_EXTRACT_ERRORS.notFound,
      });
    }
  });

  it("refuses an access token without echoing it", () => {
    const result = extractPixelId(`EAAB${"x".repeat(40)}`);
    expect(result).toEqual({ kind: "error", message: META_EXTRACT_ERRORS.accessToken });
  });

  it("refuses text longer than the field allows", () => {
    expect(extractPixelId(`${ID}${" ".repeat(META_FIELD_MAX)}x`)).toEqual({
      kind: "error",
      message: META_EXTRACT_ERRORS.tooLong,
    });
  });

  it("only ever finds values the stored schema accepts", () => {
    for (const text of [BASE_CODE, ID, `fbq('init', '${ID}')`]) {
      const result = extractPixelId(text);
      expect(result.kind).toBe("found");
      if (result.kind === "found") expect(META_PIXEL_ID_PATTERN.test(result.value)).toBe(true);
    }
  });
});

describe("pixelIdOf", () => {
  it("reads a stored id, and null for cleared or hand-edited values", () => {
    expect(pixelIdOf({ pixelId: ID })).toBe(ID);
    expect(pixelIdOf({ pixelId: null })).toBeNull();
    expect(pixelIdOf({ pixelId: "<script>alert(1)</script>" })).toBeNull();
    expect(pixelIdOf({ pixelId: 1234567890123456 })).toBeNull();
    expect(pixelIdOf(undefined)).toBeNull();
    expect(pixelIdOf("1234567890123456")).toBeNull();
  });

  it("the stored schema accepts the id or null only", () => {
    expect(metaPixelValueSchema.safeParse({ pixelId: ID }).success).toBe(true);
    expect(metaPixelValueSchema.safeParse({ pixelId: null }).success).toBe(true);
    expect(metaPixelValueSchema.safeParse({ pixelId: BASE_CODE }).success).toBe(false);
  });
});

describe("parseMetaForm", () => {
  const form = (value: string) => {
    const data = new FormData();
    data.set(META_PIXEL_FIELD, value);
    return data;
  };

  it("stores the id only, never the pasted code", () => {
    expect(parseMetaForm(form(BASE_CODE))).toEqual({ ok: true, value: { pixelId: ID } });
  });

  it("an empty field clears the connection", () => {
    expect(parseMetaForm(form(""))).toEqual({ ok: true, value: { pixelId: null } });
    expect(parseMetaForm(new FormData())).toEqual({ ok: true, value: { pixelId: null } });
  });

  it("gives the form back with the field's message", () => {
    expect(parseMetaForm(form("12345"))).toEqual({
      ok: false,
      state: { values: { pixel: "12345" }, errors: { pixel: META_EXTRACT_ERRORS.notFound } },
    });
  });
});
