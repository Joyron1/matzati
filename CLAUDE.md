@AGENTS.md

# CLAUDE.md — "מצאתי" (Matzati): Hebrew AI shopping assistant for AliExpress

> Working name: **מצאתי** ("Matzati"). The owner may rename it later, so keep the brand name in one config constant (`lib/config/brand.ts`).

## 1. What we are building

A Hebrew, RTL, mobile-first website where Israeli shoppers type what they need in free Hebrew
("אוזניות לריצה, עמידות למים, עד 100 ש״ח") and get **3 vetted AliExpress products** (plus "show 3 more"),
each with an affiliate link, trust metrics and a one-line Hebrew explanation of why it was picked.

Revenue comes from the AliExpress Affiliate Program (the owner already has an affiliate account).

Core product promises (never break these):
1. **Few, vetted results.** 3 at a time, and every one passed our filters.
2. **Honest data.** Every number shown (price, % positive feedback, units sold) comes from an AliExpress API response. Nothing invented.
3. **Transparent.** Affiliate disclosure next to every buy button. Show which filters were applied and let the user remove them.

## 2. The golden architecture rule

**The LLM understands and explains. Code searches, filters and ranks.**

- The LLM never browses the web, never picks products freely, never invents facts or numbers.
- The LLM does exactly three jobs: (a) parse the Hebrew query into structured filters, (b) write a short Hebrew "why we picked it" line per result from the provided data only, (c) write generic per-category buying tips (cached per category).
- Search, filtering, ranking and link generation are deterministic TypeScript against the AliExpress Affiliate API.

## 3. Stack

- **Next.js (App Router) + TypeScript (strict) + Tailwind CSS**, deployed on **Vercel**.
- **Supabase (Postgres)** for cache, logs, deals, price history, admin auth.
- **LLM**: provider-agnostic interface in `lib/llm/` with two adapters:
  - Anthropic (default): official `@anthropic-ai/sdk`, model from env `LLM_MODEL` (default `claude-haiku-4-5-20251001`, a small fast model is enough for parsing).
  - OpenAI: **deferred (owner decision 2026-09-27)**. We run on Anthropic only; the interface in `lib/llm/provider.ts` stays provider-agnostic so an adapter can be added later without touching callers. Do not install `openai` until the owner asks.
  - Selected by env `LLM_PROVIDER=anthropic|openai`. Check the provider's current docs for model names instead of guessing.
- **Validation**: `zod` for every external input and every LLM output.
- **Tests**: `vitest`. **Lint/format**: ESLint + Prettier.
- Theme: `next-themes` (attribute `data-theme`).

Ask the owner before adding any other dependency.

## 4. Environment variables

Create `.env.example` (committed, empty values) and read from `.env.local` (never committed).
**Never print, log or echo secret values. Never ask the owner to paste secrets into chat. They fill `.env.local` themselves.**

```
# AliExpress Open Platform (affiliate)
ALIEXPRESS_APP_KEY=
ALIEXPRESS_APP_SECRET=
ALIEXPRESS_TRACKING_ID=
ALIEXPRESS_GATEWAY=https://api-sg.aliexpress.com/sync

# LLM
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
IP_HASH_SALT=
ADMIN_EMAILS=
DAILY_SEARCH_CAP=2000
USD_ILS_FALLBACK=3.7
CRON_SECRET=
```

All AliExpress and LLM calls happen **server-side only** (route handlers / server actions). Nothing secret reaches the client bundle.

## 5. AliExpress Affiliate API

### 5.1 Client (`lib/aliexpress/`)
- Gateway: `ALIEXPRESS_GATEWAY` (`https://api-sg.aliexpress.com/sync`).
- System params: `app_key`, `method`, `timestamp` (ms), `sign_method=sha256`, `sign`, plus method params.
- Signing: sort all params by key (ASCII), concatenate `key+value` pairs, HMAC-SHA256 with the app secret, hex uppercase.
- **Verify the signing details against the official AliExpress Open Platform docs before relying on them.** Write unit tests for the signer with a known example.
- Retries: 2 retries with backoff on network errors / 5xx. Timeout 8s. Map API error codes to typed errors.

### 5.2 Methods we use
| Method | Use |
|---|---|
| `aliexpress.affiliate.category.get` | Credential check + category list |
| `aliexpress.affiliate.product.query` | Main search by keywords |
| `aliexpress.affiliate.productdetail.get` | Product page refresh by id |
| `aliexpress.affiliate.link.generate` | Affiliate link when a product lacks `promotion_link` (batch `source_values`) |
| `aliexpress.affiliate.hotproduct.query` | Ideas for the deals feed (admin only) |

Common params: `keywords`, `page_no`, `page_size` (50), `sort` (e.g. `LAST_VOLUME_DESC`), `target_currency`, `target_language` (`HE`), `ship_to_country=IL`, `tracking_id`, `min_sale_price` / `max_sale_price`.

### 5.3 Things to verify with real calls (do NOT assume)
- **Currency**: `ILS` may not be a supported `target_currency`. Try `ILS`; if rejected, request `USD` and convert with a daily USD→ILS rate (Bank of Israel official rates, cached daily in Supabase; fallback `USD_ILS_FALLBACK`). Show converted prices as approximate: `≈₪78`.
- **Price units** of `min_sale_price` / `max_sale_price` (whole units vs cents).
- **Response fields**: expected names include `product_id`, `product_title`, `target_sale_price`, `target_original_price`, `discount`, `evaluate_rate` (e.g. `"97.5%"`), `lastest_volume` (API spelling), `product_main_image_url`, `product_small_image_urls`, `product_detail_url`, `promotion_link`, `shop_id`, `shop_url`, `commission_rate`, `first_level_category_id`. Save one raw response per method to `fixtures/aliexpress/` (dev only, no secrets) and build zod schemas from real data.
- **Seller/store rating**: the affiliate API may not expose a store rating. **If no verified field exists, do not show any "seller reliability" number.** Our trust signals are then product positive-feedback % and units sold only.
- **Reviews**: review text is not available through the affiliate API. Do not build review summaries. Do not scrape AliExpress pages (violates their terms).

### 5.4 Credential check script
`scripts/check-aliexpress.ts` (run with `npm run check:ali`): calls `category.get`, a sample `product.query` for "usb cable", and `link.generate` for one product. Prints PASS/FAIL per step with secrets masked. Build this in milestone M2 before anything depends on the API.

## 6. Search pipeline — `POST /api/search`

Input: `{ q: string }` (1–200 chars, trimmed).

1. **Guard**: validate, rate-limit per hashed IP (sha256 of IP + `IP_HASH_SALT`): 20 searches/hour, 100/day. Global kill switch: refuse new LLM work after `DAILY_SEARCH_CAP` searches/day and return a clear Hebrew message.
2. **Cache (two levels, 48h; owner decision 2026-09-27)** — never trade accuracy for a hit (`lib/search/cache-key.ts`):
   - `parse_cache`: key = hash of the normalized query (spacing, niqqud, quotes, ש״ח/שקל/₪ unified). A hit skips the parse call.
   - `search_cache`: key = hash of the canonical parsed filters (sorted keywords, must_have, rounded price bounds, sort, `RANKING_VERSION`). A different phrasing that parses to identical filters reuses the results and explanations; only the parse call is paid.
   - No fuzzy or semantic text matching: reuse only when the filters that determine the results are identical.
3. **Parse (LLM)** → zod-validated JSON, schema in `lib/llm/parse.ts`, contract in `lib/search/filters.ts` (revised with the owner 2026-09-27):
   ```ts
   {
     keywords_en: string;          // 2–4 words the way sellers title the product (no gift/audience/praise words)
     product_terms: string[];      // 1–4 phrases naming the product itself: ["phone holder", "phone mount"]
     product_he: string;           // Hebrew product chip: "מחזיק טלפון לרכב"
     requirements: { en: string; alt: string[]; he: string }[]; // 0–3 stated hard requirements, ALL must match
     min_price_ils?: number;
     max_price_ils?: number;
     sort_preference: "best_value" | "cheapest" | "most_popular";
     category_hint?: string;       // used by the keyword fallback ladder
   }
   ```
   Temperature 0. One retry on invalid output; on second failure the search fails with a clear Hebrew message. Price chips are rendered by code from the numbers (`lib/search/chips.ts`), never by the LLM. `PARSE_VERSION` is part of the parse cache key.
4. **Fetch** (`lib/search/pipeline.ts`): `product.query` sorted by `LAST_VOLUME_DESC`, `ship_to_country=IL`, target ILS, price bounds in agorot. Page 2 only when page 1 was full and relevance (not trust) limited the results; then a keyword ladder (without requirement/filler words, then `category_hint`). At most 3 AliExpress calls per search, spaced ~1.1 s (their frequency ban).
5. **Filter** (`lib/ranking/`, config in `lib/ranking/config.ts`, defaults to be tuned):
   - `evaluate_rate` ≥ 90% and `lastest_volume` (30-day sales) ≥ 100; missing values fail
   - within price bounds (ILS only; prices are never compared across currencies)
   - type gate: a `product_terms` phrase early in the title, and not an accessory of it
   - every requirement matches the title (its `en`, any `alt`, or a code synonym; numeric specs like "65w" mean at least 65W)
6. **Rank**: score = weighted positive-feedback (shrunk toward 98% for small samples) + log(volume) + price fit (+ discount small weight); "cheapest" orders by price. Near-duplicate listings are removed.
   **Commission rate may only break exact ties. Never rank a worse product higher because it pays more.**
7. **Links**: use `promotion_link` if present; otherwise batch `link.generate`. A product we cannot link is not shown.
8. **Explain (LLM)** (`lib/llm/explain.ts`): for the 3 shown products, input = the displayed fields plus the search filters and their Hebrew labels. **Never the raw query**: explanations are cached 48h by filters and reused for other users. Output per product: `title_he` and `why_he` (25–120 chars).
   Post-checks reject a line with an ungrounded number, a written price, a false or unverifiable superlative, singular address, foreign or mixed script, or truncation; a rejected `why_he` falls back to a sentence built from the data ("<pct>% משוב חיובי ו־<n> נמכרו ב־30 הימים האחרונים."). `EXPLAIN_VERSION` is part of the results cache key.
9. **Store**: `search_cache`, `search_log` (query, parsed filters, result ids, no IP, no user data), upsert `products` + a `price_history` row.
10. **Respond**: `{ query, chips, sort, checked_count, passed_count, results: [...3], more_available, filters_key, cached }`. "עוד 3 אפשרויות" explains the next 3 on demand (`loadMore`).

"Remove a chip" = re-run the search with that chip id in `without`; the cached parse is reused, so there is no LLM parse call.

## 7. Pages and routes

| Route | Purpose |
|---|---|
| `/` | Home: hero, search composer with live "הבנתי ככה" chips after submit, example query buttons, next-sale countdown card |
| `/search?q=` | Results: query bar, removable chips, "בדקנו X מוצרים. Y עברו", 1 featured result + 2 compact, refine buttons, "עוד 3 אפשרויות" |
| `/p/[productId]` | Product: images, approx ILS price, optional community coupon, "למה זה עבר את הסינון" (thresholds shown), category tips (labelled generic), buy CTA, disclosure |
| `/go/[productId]` | Click-out: logs `{product_id, src, ts}` then 302 to the affiliate link. All buy buttons go through it. Links use `rel="sponsored nofollow"`. |
| `/deals` | Curated feed from `deals` table: types `deal`, `holiday`, `dont_buy`; filter buttons; WhatsApp channel CTA |
| `/admin` | Supabase Auth (magic link), allowed only for `ADMIN_EMAILS`. CRUD for deals and coupons. |
| `/disclosure`, `/privacy`, `/terms` | Static Hebrew pages with `[PLACEHOLDER]` text for the owner to complete |

Share buttons share **our** page URL (e.g. via `https://wa.me/?text=`), never the raw affiliate link.

## 8. Data model (Supabase migrations in `supabase/migrations/`)

- `search_cache(query_hash text pk, query text, parsed jsonb, response jsonb, created_at timestamptz)`
- `search_log(id bigserial pk, query text, parsed jsonb, result_ids text[], created_at)`
- `products(product_id text pk, data jsonb, title_he text, updated_at)`
- `price_history(product_id text, price_ils numeric, price_usd numeric, captured_at timestamptz)`
- `clicks(id bigserial pk, product_id text, src text, created_at)`
- `deals(id uuid pk, type text check in ('deal','holiday','dont_buy'), title text, body text, product_id text null, coupon_code text null, starts_at, ends_at, published bool default false, created_at)`
- `category_tips(category_id text pk, tips_he jsonb, updated_at)`
- `rate_limits(ip_hash text, window_start timestamptz, count int, primary key(ip_hash, window_start))`
- `fx_rates(date date pk, usd_ils numeric)`

RLS on everything. Public (anon) may only `select` from `deals where published = true`. Everything else is server-side with the service role key.

## 9. Design system (match the approved mockup)

Direction: calm, modern, trustworthy. Cool paper background, deep navy ink, cobalt for actions, marigold only for deals/highlights. Generous radii, one soft shadow reserved for the search composer and featured cards.

### Fonts (via `next/font/google`, subset `hebrew` + `latin`)
- Display / headings / logo: **Secular One**
- Body / UI / numbers: **IBM Plex Sans Hebrew** (400, 500, 600, 700)

### Color tokens (CSS variables on `[data-theme]`)
| Token | Light | Dark |
|---|---|---|
| `--bg` | `#EEF1F5` | `#0B1120` |
| `--surface` | `#FFFFFF` | `#131B2E` |
| `--surface-2` | `#E3E8EF` | `#1C2640` |
| `--ink` | `#0F1B2D` | `#E8EDF6` |
| `--muted` | `#536076` | `#9CA8BF` |
| `--line` | `#D3DAE4` | `#26324D` |
| `--accent` | `#2446D8` | `#7D95FF` |
| `--on-accent` | `#FFFFFF` | `#0B1120` |
| `--accent-soft` | `#E2E7FC` | `#1F2B55` |
| `--accent-ink` | `#1E3BB8` | `#B3C0FF` |
| `--gold` | `#F2B43A` | `#F4C25A` |
| `--gold-soft` | `#FDF1D6` | `#33291A` |
| `--on-gold` | `#0F1B2D` | `#0B1120` |
| `--invert-bg` | `#0F1B2D` | `#E8EDF6` |
| `--invert-ink` | `#F3F6FB` | `#0B1120` |
| `--shadow` | `0 18px 40px -22px rgba(15,27,45,.35)` | `0 0 0 1px #26324D` |

Map these into Tailwind (`theme.extend.colors` using `var(--…)`), never hard-code hex in components.

### Radii and sizing
- Composer / featured card: 26–30px. Regular cards: 20–22px. Chips and buttons: fully rounded (999px). Small tags: pill.
- Touch targets ≥ 44px. Primary buttons 48–58px tall.
- Mobile first: design at 390px, then desktop at 1280–1440px (two-column hero: composer on the start side, live results preview on the end side).

### Light / dark mode
- `next-themes` with `attribute="data-theme"`, `defaultTheme="system"`, `enableSystem`. No flash on load.
- Toggle = a segmented pill with two icon buttons (sun, moon), each with `aria-label` ("מצב בהיר" / "מצב כהה") and `aria-pressed`. Present in the header on every page.
- Color transitions 200ms; disabled under `prefers-reduced-motion`.

### RTL and accessibility
- `<html lang="he" dir="rtl">`. Use logical Tailwind utilities (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`). Back chevrons point right.
- Real `<button>`/`<a>`/`<label>`; visible `:focus-visible` ring in `--accent`; text contrast ≥ 4.5:1 in both themes.
- Icons: inline stroke SVG (e.g. `lucide-react`). No emoji in UI.

### Copy rules (Hebrew)
- Plural, gender-neutral imperative: "כתבו", "נסו", "חפשו".
- Buttons say what happens: "חיפוש", "לפרטים", "לקנייה באלי אקספרס", "העתקה", "הזכירו לי".
- Prices from converted USD are always shown with `≈` and the note "מחיר משוער בשקלים. המחיר הסופי מוצג באלי אקספרס."
- Disclosure under every buy button: "גילוי נאות: זה קישור שותפים. אם תקנו דרכו נקבל עמלה קטנה, בלי תוספת למחיר שלכם."
- Empty/error states give direction: e.g. no results → "לא מצאנו מוצרים שעוברים את הסינון. נסו להוריד את סינון המחיר." with that chip highlighted.
- Never claim "הכי זול" / "הכי טוב" unless computed from the result set shown.

## 10. Price monitoring (phase 2)
- Vercel Cron (daily, protected with `CRON_SECRET`): refresh `productdetail.get` for products in published deals and saved lists, write `price_history`, flag drops ≥ 10%.
- Later: email/WhatsApp alerts for saved products (requires opt-in, design separately).

## 11. Milestones (commit at the end of each; show the owner before moving on)

- **M1 – Skeleton & design**: Next.js + Tailwind + fonts + tokens + RTL + theme toggle. Static pages `/`, `/search`, `/p/[id]`, `/deals` with mock data from `lib/mock/` that visually match the mockup in both themes. Acceptance: Lighthouse accessibility ≥ 95 on mobile.
- **M2 – AliExpress client**: signer + tests, typed client, `npm run check:ali` passes with the owner's credentials, fixtures saved, zod schemas from real responses, currency handling decided.
- **M3 – LLM layer**: provider interface, parse + explain prompts, zod validation, number post-check, tests with 15 real Hebrew fixture queries (gifts, kids, car, home, tech, price limits, typos, slang).
  Status 2026-09-27: done. Eval of 20 real queries (15 + 5 held out) recorded in `fixtures/llm/`; see `docs/eval-m3.md`.
- **M4 – Search end-to-end**: `/api/search` pipeline, cache, rate limit, kill switch, `/go` click-out, real results on `/search`.
- **M5 – Product page, deals, admin**: product refresh, category tips cache, deals CRUD in `/admin`, public `/deals`.
- **M6 – Deploy**: Supabase migrations applied, Vercel env vars set by the owner, production deploy after the owner approves.
- **Phase 2**: price cron, SEO pages for popular queries (`/s/[slug]`, statically generated), sitemap, analytics (only with a cookie notice).

## 12. Working rules for Claude Code

- Code and comments in English; all user-facing text in Hebrew.
- Before calling any paid or quota-limited API in bulk (LLM, AliExpress), say how many calls you are about to make.
- Do not create cloud resources (Supabase projects, Vercel projects, domains) or anything with a cost without explicit owner approval.
- Never commit `.env.local`, fixtures containing secrets, or raw IPs.
- Run `npm run lint`, `npm run typecheck` and `npm test` before every commit.
- When an AliExpress field or behavior is uncertain, test it with the check script or read the official docs. Do not guess.
- Keep functions small and pure where possible (`lib/ranking`, `lib/aliexpress/sign` are pure and fully unit-tested).

## 13. Commands

```
npm run dev          # local dev
npm run build        # production build
npm run lint
npm run typecheck
npm test             # vitest
npm run check:ali    # AliExpress credential & API check
```
