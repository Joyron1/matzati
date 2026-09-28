# Search quality, wave A: what changed and what to check (2026-09-28)

Implements wave A of docs/search-quality-plan.md (items 0 to 10) plus item 12, as approved by the
owner on 2026-09-28. Nothing is committed, no migration is applied and nothing is deployed yet.

## בקצרה

- התיקונים של גל א׳ מוכנים בקוד ונבדקו בחינם על 32 חיפושים שמורים. המוצר הראשי נכון ב־31 מתוך 32
  (היה 25 מתוך 31), ויש מוצר לא נכון אחד ב־3 הראשונים (היו 6).
- המספרים האלה הם הערכה בלבד: אותם 32 חיפושים שימשו גם לכיוון הקוד, והסימונים (מדויק, סביר, חלש, לא
  נכון) נכתבו על ידי סוכנים ולא על ידיכם. הבדיקה המסכמת בתשלום (סעיף 11) היא ההחלטה אם עולים לאוויר.
- לפני העלייה: להחיל את המיגרציה `20260928140000_search_telemetry.sql`, ואז לפרוס.
- החלטה שמחכה לכם: חנות אחת (״Stone's Store״) מופיעה כמוצר הראשי ב־22 מתוך 28 חיפושים, וכמעט לכל
  המוצרים שלה בדיוק 98% משוב חיובי. כדאי לאשר את 2 הפניות לאלי אקספרס שבודקות את המספר הזה לפני
  פרסום ממומן.
- יש לעבור על הסימונים שמופיעים ברשימה למטה, כי זוגות של חיפושים זהים סומנו אחרת.

## Paid calls in the whole wave

5 LLM parse calls ($0.01006) and 86 AliExpress requests, all in the snapshot run (plan item 1). No
other agent made a paid or AliExpress call, no production row was written, and the only database
access was read-only SELECTs.

## What changed

- **0. Hygiene.** Every `search_log`, `llm_usage` and `clicks` row carries `env` (`VERCEL_ENV`);
  stats, `/searches` and the home strip read production only. Outside production the parse and
  results caches use `dev:` / `preview:` keys, the guard counters too (`dev:llm:day`, so a dev run
  never spends production's `DAILY_SEARCH_CAP`), and `products` only gets rows production does not
  have (never an update of a title or link it serves, no `price_history`). The home example is the
  smartwatch query (`ex-7`); the ideas row no longer repeats it and no longer has the weak backpack
  idea: the power bank and house slippers queries (both checked on their snapshots) replace them.
- **1. Offline eval.** 32 product-pool snapshots (`fixtures/snapshots/`), 3,419 labels, and
  `npm run eval:offline` (no network, LLM or env). The snapshot script now captures exactly the
  calls the live pipeline makes, reuses a saved parse only for the same query text, and its
  `--report` replays the live fetch policy.
- **2. Relevance.** Score part for how plainly the title names the product (`relevance.ts`, weight
  3); passers from another category than two thirds of them go last (default sort only); a
  first-page line that says its product is another product moves it off the first page
  (`demoteFlaggedLeads`).
- **3. Type gate.** Narrow synonym groups and one-way kinds (a cutlery tray is a drawer organizer, a
  wireless car charger is a car phone holder, color matching is color sorting); more accessory
  nouns; holders only after the product term; unsearched objects (car, bike, Tesla, headrest) at the
  start, right before the term or right before the product's own noun anywhere ("... Car
  Charger"); a cable right after a charger's name; leading words of a long term must stand close to
  the product words and not inside "multi-color". "slides" became "house slides", "u shaped pillow"
  left the neck pillow group.
- **4. Variety.** One product per shop on the first page, two in the 12 kept; wider duplicate
  check; exact capacity before a bigger one, and a "small" search caps capacity at 1.5x.
- **5. Wider pool.** Fetch until 6 pass or 3 calls, next step by what blocked (`fetch-policy.ts`).
- **6. Sort fixes.** "Most popular" by sales and "cheapest" by price, whatever the category; no
  discount in the score; no bonus for being cheap inside a stated budget.
- **7. Resilience.** Only the first AliExpress call can fail a search; a failed explain shows data
  lines and caches 48 h; a model failure is `llm` with honest copy; per-step limits; a gap before
  `link.generate` too; products that passed but cannot be linked fail as `upstream`, never "none
  passed".
- **8. Parse guards (`PARSE_VERSION` 6).** Alts with another meaning dropped; descriptions reduced to
  a feature phrase, else kept as a **preference** (no chip, no filter; its words count toward
  relevance, and `/search` says "את ״X״ לא סיננו, רק העדפנו מוצרים שהשם שלהם מזכיר את זה.");
  gift terms become sets; plain product terms added, never for an audience term ("kids
  headphones"); a parse that found nothing is kept 48 h; removing a requirement chip removes its
  keywords.
- **9. Hebrew checks (`EXPLAIN_VERSION` 5).** Title repair (Latin words, names after "for"), budget
  word only with a budget, repeated lines, misspellings; the labels are part of the results key.
- **10. Measurement.** `origin`, removed chips, sort, step timings, AliExpress calls, rejections,
  failures, `search_uid` and card position on clicks, `owner` for a signed-in admin's searches and
  clicks (left out of stats and `/searches`), and `diag` (fetch stop, keyword steps, demotions,
  explain fallbacks). New `/admin/stats` sections.
- **12. What blocked.** For fewer than 3 results, each removable filter with how many of the checked
  products would pass without it ("בלי הסינון הזה היו עוברים N מהמוצרים שכבר בדקנו"), a remove
  button, never a product that failed.

Cache keys now keep the order the code reads (first product term and requirement), the category
hint, the preference words and the Hebrew labels. `RANKING_VERSION` 6, `PARSE_VERSION` 6 and
`EXPLAIN_VERSION` 5 each empty their caches on deploy: warm the examples afterwards (item 11).

## Metrics (offline replay, in-sample)

`npm run eval:offline` over the 32 snapshots with the live fetch policy. "Stored" uses each
snapshot's recorded parse; "renorm." runs it through today's `normalizeParsed`, the closest free
stand-in for what `PARSE_VERSION` 6 will parse. Baseline is `report-baseline-r5.json` (before wave
A); "agents" is the tree when the fixes below started; "after" is saved as `report-wave-a.json` and
`report-wave-a-renorm.json`.

| Metric (32 queries)                         | Baseline    | Agents, stored / renorm. | After, stored / renorm.       | Plan target |
| ------------------------------------------- | ----------- | ------------------------ | ----------------------------- | ----------- |
| First result exact or reasonable            | 25/31       | 31/32 / 30/32            | 31/32 / 31/32                 | 18 of 19    |
| Shown cards exact or reasonable             | 73/90 (81%) | 86/95 / 86/96            | 86/95 (90.5%) / 87/96 (90.6%) | 90%         |
| Wrong products in the top 3                 | 6           | 1 / 1                    | 1 / 1                         | 0           |
| 2+ from one shop in the top 3               | 25          | 4 / 4                    | 3 / 3                         | 0           |
| No results                                  | 1           | 0 / 0                    | 0 / 0                         | 0           |
| 1-2 results                                 | 3           | 1 / 0                    | 1 / 0                         |             |
| Exactly 3 (no "more")                       | 5           | 3 / 3                    | 3 / 3                         | 1 of 19     |
| 6 or more passed                            | 23          | 28 / 29                  | 28 / 29                       | 90%         |
| Good products the type gate rejects         | 649         | 333 / 265                | 280 / 212                     |             |
| Weak or wrong products passing every filter | 74          | 38 / 44                  | 36 / 36                       |             |
| AliExpress calls (replay)                   | 41          | 38 / 36                  | 38 / 36                       |             |
| Incomplete (a call the snapshot lacks)      | 1           | 4 / 3                    | 4 / 3                         |             |

The 20 eval queries alone, after: first result 20/20 / 20/20, cards 55/59 (93%) / 56/60 (93%),
1 wrong product in the top 3 (both), 1 query with 2 from one shop (price-watch), 6+ passed in 18 /
19 of 20.

What the fixes changed on top of the agents' work: tech-charger with the new parse leads with an
exact 67W GaN charger instead of a weak ₪17.56 phone charger (the dropped "for phone and laptop"
is now a preference), exact car holders, cutlery trays and color-matching toys pass (42 exact
products counting the twin pools), 8 charger cables and a car charger stop passing a charger
search, the juggling sandbags left the
color-toy search, and "cheapest" on cheapest-cable shows ₪4.35, ₪4.98 and ₪5.23 instead of a ₪16.49
card.

How to read these numbers:

- **In-sample.** Every ranking and type-gate rule was tuned on these 32 labelled pools; there is no
  held-out set, and a set chosen now from these pools would not be held out. The plan's ~10
  held-out queries have to come from new queries (ad keywords, the first real visitor queries).
- **Agent labels.** All 3,419 labels were written by agents judging as buyers, not by a person
  (the header of `lib/eval/labels.ts` now says so). Several same-intent pairs disagree (below).
- **Not everything is replayable.** 4 queries ask for calls the snapshots lack (home-nightlight and
  ex-5 "motion sensor night light" p1, live-sonic-doll "sonic plush" p1, tech-charger "65w charger"
  p1 with the stored parse), and the first-page safety net depends on live explanations.
- **Targets not met offline:** 1 wrong product in the top 3 (ho-gift-garden #2, "Garden Tools
  Brass Water Faucet"), 3 queries with 2 from one shop (kids-toy is fixed; price-watch, ex-7 and
  live-soundbar have only one other passing shop), 3 queries with exactly 3 results (all three
  incomplete).
- **Explicit sorts:** "cheapest" leads correctly in 25 of 32 with 4 wrong cards in the top 3, and
  "most popular" in 28 of 32 with 3, because both now order by price or sales alone, as their
  buttons say. Limiting "cheapest" to products above a relevance floor is an owner decision.

## Before deploying: decisions for the owner

1. **One store leads most searches, with a suspicious feedback number.** Shop 1103573332 ("Stone's
   Store") holds 1,031 of the 3,027 distinct snapshot products, across unrelated categories and
   under many brand names (Essager, Toocki, UYUXIO, LAXASFIT, ZEALOT, Tribit, Lenovo). 996 of its
   1,031 products show exactly 98.0% positive feedback; among the 1,996 products of every other
   store, 98.0% is not even among the six most common values. Its listing is the first result in 22
   of 28 distinct queries (23 at baseline); the shop cap only cut its share of top-3 cards from 62
   of 79 to 27 of 83. `FEEDBACK_PRIOR` never lowers exactly 98%. This looks like a store-level or
   default value shown as each product's own. Run the plan's 2-call `productdetail.get` spot check
   (1005006995257180 and 1005007011605676) before paid ads, then decide: treat a store-wide
   identical value as unknown, pull it toward a lower prior, or accept it. No ranking change was
   made for it: it needs that data and your decision.
2. **The home example.** "שעון חכם עם מד דופק עד 150 ש״ח" passes 6 products under the live fetch
   policy (not 14), all labelled exact, but its first result is a ₪14.49 listing of that store
   (the price-watch labeller flagged a ₪4.18 sibling as a bait variant), and 5 of its first 6 come
   from it. Sign off at the final check or pick another; the power bank query (now an idea on the
   home page) has none of that store's products in its first 6 (Baseus, Vention, UGREEN). The gift idea "מתנה לאבא
   שאוהב לבשל עד 200 ש״ח" still shows one reasonable and two weak products; no gift query in the
   snapshots does better, so it stays until you choose.
3. **Labels to review.** Resolve each pair with one rule, apply it to both files, re-run
   `npm run eval:offline -- --against wave-a`:

   | Queries (same intent)                               | Shared products | Labels that differ                                                                                  |
   | --------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
   | ex-7 / price-watch (smartwatch with heart rate)     | 66              | 17: 15 "Health Monitoring" watches exact vs reasonable, 2 weak vs reasonable                        |
   | ex-6 / ho-speaker (waterproof speaker, 50-150)      | 101             | 10: 8 shower phone boxes and marine speakers weak vs wrong, 2 exact vs reasonable (Philips TAS1120) |
   | ex-8 / price-range-bag (waterproof hiking backpack) | 19              | 6: 3 tactical packs exact vs reasonable, 3 reasonable vs weak                                       |
   | ex-5 / home-nightlight (same query, same pool)      | 41              | 3: 2 sunset lamps weak vs wrong, 1 sensor light reasonable vs weak                                  |
   | pair-a / typo-earbuds                               | 36              | 5 (Pro 6 clones weak vs reasonable)                                                                 |
   | pair-a2 / typo-earbuds                              | 41              | 7 (POLVCDG X9 exact vs reasonable, clones weak vs reasonable)                                       |
   | ex-3 / home-drawer                                  | 127             | 1                                                                                                   |

   Also check two single calls the lead verdicts rest on: live-soundbar #1 "Portable Wireless
   Soundbar ... Outdoor Indoor" (weak) against #3 "... Wireless Soundbar Subwoofer ... Portable Home
   Theater Audio" (exact), and ho-gift-garden's L-shaped gap weeders (#3, #6: reasonable although its
   rule calls hand weeders exact).

## Migration and deploy order

1. Apply `supabase/migrations/20260928140000_search_telemetry.sql` (not applied yet; the latest
   applied is the coupons migration). It adds `env` to `search_log`, `llm_usage` and `clicks`
   (older rows become `legacy`); `origin`, `without`, `sort_override`, `timings`, `ali_calls`,
   `rejected`, `failure`, `search_uid`, `shared`, `owner` and `diag` to `search_log`;
   `search_uid`, `position` and `owner` to `clicks`; it rewrites the stats functions and
   `recent_search_cards` to read production rows that are not the owner's, and adds
   `stats_by_origin`, `stats_failures` and `stats_click_positions`. Every new column is nullable or
   has a default, so the live code keeps working after it.
2. Deploy. Until the migration exists, the new code's log inserts fail (the searches still work,
   the rows are lost).
3. Check that production rows are tagged production (the Vercel project read was refused, so
   "Automatically expose System Environment Variables" is unconfirmed):
   `select env, count(*) from search_log where created_at > now() - interval '1 hour' group by env`.
4. `/searches` and the home strip start empty: every earlier row is `legacy`.
5. Warm the example queries (item 11). A warm-up script run from a laptop resolves to
   `development` and would write `dev:` keys: it must build `new SupabaseStore(db, { env:
"production" })`, and run as the owner (or mark its rows `owner`) so it is never counted or
   listed as a visitor.

## What the final paid check (A11) must verify

- The plan's gate on live parses: first result exact or reasonable in at least 18 of 19, no wrong
  product in the top 3, at least 90% of queries with 6 or more passing, copy defects at 10% or
  less, and your sign-off on the home example.
- The queries the replay cannot settle: home-nightlight, the sonic doll and tech-charger with their
  real extra calls; tech-charger's note "את ״לטלפון ולמחשב נייד״ לא סיננו..." and its lead.
- gift-cook (the parse still names "kitchen tools set"; grinders and sharpeners fail the gate) and
  ho-gift-garden (the faucet at #2).
- live-soundbar's lead, and whether the safety net moves any lead live.
- The store question above, before any ad points at a search.
- One row of each kind in `search_log` and `clicks` after deploy: `env`, `owner` (a search made
  while signed in to `/admin`), `diag`, `search_uid` on a click, and a failure row.
- The no-results page with a requirement blocker and the partial-results hint, in both themes.

## Gaps left for later

- The caulking tool set still passes the kitchen gift search through "Tools For Kitchen" (the "for
  <use>" phrasing that "Earbuds ... for Running" needs); the category rule keeps it off the first
  page. The real fix is the gift parse (item 8, prompt change in a later wave).
- "Swimming" is not waterproof evidence (5 exact earphones in the pools would pass with it, but
  "Swimming Shoes" drain water and a requirement is matched without knowing the product).
- The plain product nouns stay: without them 33 exact and 10 reasonable running earphones stop
  passing and no weak or wrong one does.
- The shop cap stays at one per page: at two, cards exact or reasonable fall from 86 to 84 of 95
  and 26 queries show two from one shop.
- Explain has no retry; "cheapest" ignores relevance; the capacity cap reads only English words.

## Re-running

```
npm run eval:offline -- --against wave-a                  # a ranking change against this state
npm run eval:offline -- --renormalize --against wave-a-renorm
npx tsx scripts/snapshot-pools.ts --report                # pool statistics, live fetch policy
```

The next snapshot refresh (fixtures/snapshots/README.md) captures the calls the live policy wants
and parses the changed home examples; it needs owner approval (up to 3 LLM calls, up to 100
AliExpress requests).
