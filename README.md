# מצאתי (Matzati)

Hebrew, RTL, mobile-first shopping assistant for AliExpress. Users describe what they need in
free Hebrew and get 5 vetted products with affiliate links. The full spec and working rules are in
[CLAUDE.md](CLAUDE.md).

Production: https://matzati-il.vercel.app (Vercel project `matzati-il`).

## Status

- **M1 – Skeleton & design: done.**
- **M2 – AliExpress client: done.** Verified API behavior: [docs/aliexpress-api.md](docs/aliexpress-api.md).
- **M3 – LLM layer: done.** Eval: [docs/eval-m3.md](docs/eval-m3.md).
- **M4 – Search end to end: done.** Real results on `/search`, `/p/[id]`, the home preview and `/go` click-out; two-level cache (48h then, 14 days since 2026-09-27), per-IP rate limits and a daily LLM budget in Supabase.
- **M5 – Admin, deals, tips: done.** `/admin` (magic-link login, ADMIN_EMAILS only) manages deals and coupons; `/deals` and the home countdown read published deals; `/p` shows generic category tips (LLM job c, cached per category) and community coupons. The deals link appears only when a published deal exists.
- **M6 – Deploy: live** on Vercel (Git-connected).
- **Phase 2 (part 1): done.** SEO landing pages `/s/[slug]` (managed in `/admin/seo`, ISR daily, real results from the 14-day cache), `sitemap.xml` and `robots.txt`; `/admin/stats` (searches per day, cache hit rate, LLM cost from `llm_usage`, top and zero-result queries, top clicked products); stricter accessory gate and shorter LLM prompts. Price cron and analytics are still open.
- **Recent searches: done.** `/searches` lists visitor searches that found products (one card per normalized query, with photos, chips, category and text filters; privacy filter in `lib/recent/privacy.ts`, admin hide in `/admin/searches`, `noindex`), plus a strip on the home page. Results older than 24h show when prices were checked.
- **Phase 2 (part 2): done** (plan approved 2026-09-28). `/p` shows the AliExpress video, AliExpress promo codes and our coupons, and a reviews card (no review text: a link to the reviews on AliExpress through `/go?src=reviews`); `/go` regenerates affiliate links older than `LINK_MAX_AGE_DAYS`; SKU variants are built behind `SKU_DETAILS_ENABLED`, off until AliExpress grants `product.sku.detail.get`. Coupons: `coupons` table, `/admin/coupons`, public `/coupons`. Sales calendar `/sales`: countdowns, upcoming sales, a 12-month calendar and add-to-calendar `.ics` files. Coupons and sale dates are the owner's and labelled as ours. Apply `supabase/migrations/20260928090000_coupons.sql` before deploying.
- **Five results and the shop cap setting: built, not deployed** (owner decisions 2026-09-28). Pages of 5 (`RESULTS_PER_PAGE`, 15 kept), explanations that compare within the batch shown ("מבין החמישה" ... "מבין השניים"), a shop cap chosen in `/admin/settings` ("none", the default, or "max2"), every kept product saved for `/p`'s similar products, and known loan words fixed in AliExpress's Hebrew titles. `RANKING_VERSION` 8 and `EXPLAIN_VERSION` 6 empty the results cache on deploy. Apply `supabase/migrations/20260928230000_five_results.sql` and `20260928230100_site_settings.sql` before deploying; numbers in [docs/search-quality-wave-a.md](docs/search-quality-wave-a.md#five-results-2026-09-28).
- **Tracking id hygiene: done.** Committed fixtures hold `<ALIEXPRESS_TRACKING_ID>` instead of the real id, `check:ali -- --save` masks every `.env.local` value, and `lib/fixtures-secrets.test.ts` guards `fixtures/` locally. The id stays in git history (commit 5b698fc); see [docs/aliexpress-api.md](docs/aliexpress-api.md#open-items).

Local dev needs Node 22+, or Node 20.10+ with `--experimental-websocket` (set in the `dev` and `start` scripts) because supabase-js needs a WebSocket global.

## Retention

A daily database job deletes old data so the periods on `/privacy` hold:
`supabase/migrations/20260928200000_retention.sql` enables pg_cron (Supabase Cron) and schedules
`public.run_retention()` as job `matzati-retention` at 00:30 UTC (03:30 Israel summer time, 02:30
winter time). It deletes rate-limit counters (salted IP hashes) 48 hours after their window ends,
`search_log` and `clicks` rows after 12 months, a hidden search's text 12 months after it was
hidden once no `search_log` row has it, `llm_usage` and `price_history` after 24 months, and
`parse_cache` / `search_cache` rows after 30 days; a row can outlive its period by up to a day.
Products, deals, coupons and SEO pages are kept. No app code depends on it, but `/privacy` states
these periods: apply it before deploying the legal pages. Check runs with
`select * from cron.job_run_details order by start_time desc limit 5;`, run it by hand (as
postgres) with `select public.run_retention();`.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values yourself; never commit .env.local
npm run dev
```

## Commands

```bash
npm run dev          # local dev
npm run build        # production build
npm run lint
npm run typecheck
npm test             # vitest
npm run format       # prettier
npm run check:ali    # AliExpress credential & API check (3 calls; -- --save refreshes masked fixtures)
```

## Layout

| Path                    | What                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `app/`                  | Routes: `/`, `/search`, `/p/[productId]`, `/go/[productId]`, `/deals`, `/coupons`, `/sales`, static pages |
| `components/`           | UI. Shared button/card classes in `components/styles.ts`                                                  |
| `app/globals.css`       | Design tokens (light/dark on `[data-theme]`) mapped into Tailwind                                         |
| `lib/config/`           | Brand name and site flags (`USING_MOCK_DATA`)                                                             |
| `lib/ranking/config.ts` | Filter thresholds, also shown in the UI                                                                   |
| `lib/mock/`             | M1 sample data, replaced by the real pipeline in M4                                                       |
| `lib/types.ts`          | Wire types shared by the API and the UI                                                                   |
