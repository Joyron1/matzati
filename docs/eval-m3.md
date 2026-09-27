# M3 LLM evaluation (2026-09-27)

Model: `claude-haiku-4-5-20251001`. Runs go through the real pipeline (`scripts/eval-llm.ts`)
with an in-memory cache. Recordings: `fixtures/llm/eval-2026-09-27.json` (round 1) and
`fixtures/llm/eval-v2-2026-09-27.json` (round 2).

## Results

|                                                         | Round 1 (15 queries) | Round 2 (15 + 5 held out) |
| ------------------------------------------------------- | -------------------- | ------------------------- |
| Queries with 3 results                                  | 10                   | 18                        |
| Queries with 0 results                                  | 5                    | 0                         |
| Explanations kept (others fell back to a data sentence) | 23 of 26             | 55 of 58                  |
| Cross-phrasing cache hits (same filters)                | 1                    | 1                         |
| Cost per search (parse + explain)                       | $0.0036              | $0.0066                   |

Round 1 problems, found by three independent judges: keywords full of gift/audience words (zero
results), requirements split into single words so they were not enforced (a watch "with heart
rate" whose title never mentions it, described as having one), accessories shown as the product,
and explanations that could leak one user's details into a cached result. Round 2 fixed these
with the revised filters contract (`lib/search/filters.ts`), the type gate and AND-ed requirements
in `lib/ranking/`, and filters-only explain context with stricter post-checks.

Cost rose because the prompts are ~2.5x longer (parse ≈2,500 input tokens, explain ≈2,100).
Output tokens did not change. Claude Haiku 4.5 caches prompts only from 4,096 tokens, so prompt
caching does not apply yet. At 1,000 searches that is about $6.6 (≈₪20) before our 48h cache.

## Known tuning items

- Accessories still slip through the type gate occasionally (a padlock pick set titled "... Home
  Garden Tools", a bike bottle holder for "water bottle"). The explain step labels them honestly,
  but the gate should drop them.
- Parse occasionally mistranslates ("לגן" as garden next to kindergarten) or misspells a Hebrew
  label ("אטום לדיסות").
- The explain line sometimes says "הכותרת לא מציינת ..." about features nobody asked for.
- Trimming the prompts could bring the per-search cost back toward $0.004; measure quality first.
