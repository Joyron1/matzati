# מצאתי (Matzati)

Hebrew, RTL, mobile-first shopping assistant for AliExpress. Users describe what they need in
free Hebrew and get 3 vetted products with affiliate links. The full spec and working rules are in
[CLAUDE.md](CLAUDE.md).

## Status

- **M1 – Skeleton & design: done.** All pages render mock data from `lib/mock/` (a banner says so).
- **M2 – AliExpress client: done.** Signer, typed client, zod schemas from real responses, `npm run check:ali` passes. Verified API behavior: [docs/aliexpress-api.md](docs/aliexpress-api.md).
- Supabase project `matzati` (eu-central-1) has the §8 schema applied (`supabase/migrations/`).
- M3–M6: see the milestones in CLAUDE.md.

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

Useful demo URLs while on mock data: `/search?q=...&demo=empty` shows the no-results state.
