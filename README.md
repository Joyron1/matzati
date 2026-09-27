# מצאתי (Matzati)

Hebrew, RTL, mobile-first shopping assistant for AliExpress. Users describe what they need in
free Hebrew and get 3 vetted products with affiliate links. The full spec and working rules are in
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

Local dev needs Node 22+, or Node 20.10+ with `--experimental-websocket` (set in the `dev` and `start` scripts) because supabase-js needs a WebSocket global.

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
npm run check:ali    # AliExpress credential & API check (3 calls; add -- --save to refresh fixtures)
```

## Layout

| Path                    | What                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `app/`                  | Routes: `/`, `/search`, `/p/[productId]`, `/go/[productId]`, `/deals`, static pages |
| `components/`           | UI. Shared button/card classes in `components/styles.ts`                            |
| `app/globals.css`       | Design tokens (light/dark on `[data-theme]`) mapped into Tailwind                   |
| `lib/config/`           | Brand name and site flags (`USING_MOCK_DATA`)                                       |
| `lib/ranking/config.ts` | Filter thresholds, also shown in the UI                                             |
| `lib/mock/`             | M1 sample data, replaced by the real pipeline in M4                                 |
| `lib/types.ts`          | Wire types shared by the API and the UI                                             |
