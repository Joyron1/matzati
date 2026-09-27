// Turns what an admin pastes into the deal form (a product id, an AliExpress item URL, or the
// share text the AliExpress app copies) into a product id. Pure; no network calls, so short links
// that only reveal the id after a redirect are reported rather than followed.

export const PRODUCT_ID_PATTERN = /^\d{1,20}$/;

export type ProductIdError = "invalid" | "not_aliexpress" | "short_link" | "no_id";

export type ProductIdResult = { ok: true; id: string } | { ok: false; error: ProductIdError };

export const PRODUCT_ID_ERRORS: Record<ProductIdError, string> = {
  invalid: "כתבו את מספר המוצר (ספרות בלבד) או הדביקו קישור לדף המוצר באלי אקספרס.",
  not_aliexpress:
    "הקישור הזה לא מאלי אקספרס. הדביקו קישור לדף המוצר באלי אקספרס, או רק את מספר המוצר.",
  short_link: "זה קישור מקוצר. פתחו אותו בדפדפן והדביקו את הכתובת המלאה של דף המוצר.",
  no_id: "לא מצאנו מספר מוצר בקישור. הדביקו את הקישור מדף המוצר עצמו, לא מדף של חנות או של חיפוש.",
};

// aliexpress.com, he.aliexpress.com, m.aliexpress.com, aliexpress.us, aliexpress.ru, …
const ALIEXPRESS_HOST = /(^|\.)aliexpress\.(com|us|ru)$/i;
// Hosts that redirect to the product page and carry no id of their own.
const SHORT_LINK_HOST = /^(a|s\.click|click)\.aliexpress\.(com|us|ru)$/i;
// /item/1005006123456789.html, /i/1005006123456789.html (mobile), also without ".html".
const ITEM_PATH = /\/(?:item|i)\/(\d{1,20})(?:\.html?)?\/?$/i;
// Old store links: /store/product/<slug>/<storeId>_<productId>.html
const STORE_PATH = /\/store\/product\/[^/]*\/\d+_(\d{1,20})\.html?$/i;
const ID_PARAMS = ["productId", "productIds", "itemId"];

function parseUrl(text: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

export function extractProductId(input: string): ProductIdResult {
  const text = input.trim();
  if (PRODUCT_ID_PATTERN.test(text)) return { ok: true, id: text };
  if (!text || /^\d+$/.test(text)) return { ok: false, error: "invalid" };

  // Share text from the app ("…מצאתי את זה באלי אקספרס https://a.aliexpress.com/_x") holds the
  // link somewhere inside; otherwise the whole value should be the link.
  const candidate = text.match(/https?:\/\/\S+/i)?.[0] ?? text;
  if (/\s/.test(candidate)) return { ok: false, error: "invalid" };
  const url = parseUrl(candidate);
  if (!url || !url.hostname.includes(".")) return { ok: false, error: "invalid" };
  if (!ALIEXPRESS_HOST.test(url.hostname)) return { ok: false, error: "not_aliexpress" };

  const fromPath = ITEM_PATH.exec(url.pathname)?.[1] ?? STORE_PATH.exec(url.pathname)?.[1];
  if (fromPath) return { ok: true, id: fromPath };
  for (const name of ID_PARAMS) {
    const value = url.searchParams.get(name)?.split(",")[0]?.trim();
    if (value && PRODUCT_ID_PATTERN.test(value)) return { ok: true, id: value };
  }
  return { ok: false, error: SHORT_LINK_HOST.test(url.hostname) ? "short_link" : "no_id" };
}
