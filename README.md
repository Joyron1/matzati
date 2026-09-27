# מצאתי (Matzati)

Hebrew, RTL, mobile-first shopping assistant for AliExpress. Users describe what they need in
free Hebrew and get 3 vetted products with affiliate links. The full spec and working rules are in
[CLAUDE.md](CLAUDE.md).

## Status

- **M1 – Skeleton & design: done.**
- **M2 – AliExpress client: done.** Verified API behavior: [docs/aliexpress-api.md](docs/aliexpress-api.md).
- **M3 – LLM layer: done.** Eval: [docs/eval-m3.md](docs/eval-m3.md).
- **M4 – Search end to end: done.** Real results on `/search`, `/p/[id]`, the home preview and `/go` click-out; 48h two-level cache, per-IP rate limits and a daily LLM budget in Supabase.
- **Still mock:** `/deals` (M5, with the admin).
- M5–M6: see the milestones in CLAUDE.md.

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
