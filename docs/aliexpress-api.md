# AliExpress Affiliate API: verified behavior

What we confirmed for M2 (CLAUDE.md §5.3), with how we know it. Re-verify with `npm run check:ali`
(3 calls) and `scripts/probe-aliexpress.ts` (5 calls).

## Protocol

| Topic     | Finding                                                                                                                                                                                                        | Source                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Gateway   | `POST https://api-sg.aliexpress.com/sync`, all params as `application/x-www-form-urlencoded`                                                                                                                   | Official doc 1385 + real calls                                                                                   |
| Signature | Sort all sent params except `sign` by key (code-point order), concatenate `key+value`, HMAC-SHA256 with the app secret, uppercase hex. No path prefix for `/sync` business methods; `method` is a signed param | Official vector `F7F7926B…` (doc 1385), official iop-sdk-python `sign()`; tests in `lib/aliexpress/sign.test.ts` |
| Values    | Signed raw (not URL-encoded); empty values are neither sent nor signed                                                                                                                                         | Official SDK                                                                                                     |
| Timestamp | Epoch milliseconds as a string                                                                                                                                                                                 | Official SDK                                                                                                     |
| Errors    | Gateway errors: `{ error_response: { type, code, msg, sub_code?, sub_msg?, request_id } }`. Business errors: HTTP 200 with `resp_result.resp_code != 200`; `405` means empty result                            | Docs + real `InsufficientPermission` response                                                                    |
| Large ids | `sku_id` exceeds 2^53; the client quotes `*_id` numbers before `JSON.parse`                                                                                                                                    | Real response (`…163` parsed as `…164`)                                                                          |

## Parameters and fields

| Topic         | Finding                                                                                                                                                                                    | Source                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Currency      | `target_currency=ILS` works for `product.query` and `productdetail.get`. Prices in `target_*` fields; `sale_price`/`original_price` stay in the store's currency (CNY/USD) and are ignored | Real calls                                           |
| FX            | AliExpress's own ILS conversion was ≈3.11 ₪/$ vs Bank of Israel 3.033. We show AliExpress's ILS figure (what the buyer sees). BoI is only a fallback for a non-ILS product, shown with ≈   | Real calls + boi.org.il                              |
| Price filter  | `min_sale_price`/`max_sale_price` are minor units of `target_currency`: ₪100 → `10000`                                                                                                     | Probe: cap 1000 gave max ₪9.16 (ILS) and $4.26 (USD) |
| Language      | `target_language=HE` returns machine-translated Hebrew titles. We search with `EN` so the must_have check (§6.5) runs on the original English title; the LLM writes `title_he` (§6.8)      | Real calls                                           |
| Sort          | Default order is poor (a flip phone for "usb cable"). `LAST_VOLUME_DESC` surfaces established products but still mixes accessories, so the must_have filter matters                        | Real calls                                           |
| Trust fields  | `evaluate_rate` ("97.2%", may be `""`/missing), `lastest_volume` (sales in the last 30 days per the docs). No store/seller rating exists in any affiliate method, so we show none          | Docs + fixtures                                      |
| Links         | `product.query` returns `promotion_link` when `tracking_id` is sent; `link.generate` takes up to 50 comma-separated `source_values`                                                        | Real calls + docs                                    |
| Images        | Served from `ae-pic-a1.aliexpress-media.com` (allowed in `next.config.ts`)                                                                                                                 | Fixtures                                             |
| Wrapped lists | `products.product[]`, `categories.category[]`, `promotion_links.promotion_link[]`, `product_small_image_urls.string[]`                                                                     | Fixtures                                             |

## Open items

- `aliexpress.affiliate.hotproduct.query` returns `InsufficientPermission` for this app. Only the admin
  deals feed needs it; the owner can request access in the AliExpress Open Platform console.
- Rate limits are not documented per method. The client retries network errors and 5xx twice with
  backoff (400 ms, 1200 ms) and does not retry auth, parameter or rate-limit errors.
