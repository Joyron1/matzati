# M3 LLM evaluation (2026-09-27)

Model: `claude-haiku-4-5-20251001`. Runs go through the real pipeline (`scripts/eval-llm.ts`)
with an in-memory cache. Recordings: `fixtures/llm/eval-2026-09-27.json` (round 1),
`fixtures/llm/eval-v2-2026-09-27.json` (round 2) and `fixtures/llm/eval-v3-<date>.json` (round 3,
see the placeholder section below).

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

## Known tuning items after round 2

- Accessories still slip through the type gate occasionally (a padlock pick set titled "... Home
  Garden Tools", a bike bottle holder for "water bottle"). The explain step labels them honestly,
  but the gate should drop them. _Round 3: fixed offline, see below._
- Parse occasionally mistranslates ("לגן" as garden next to kindergarten) or misspells a Hebrew
  label ("אטום לדיסות"). _Round 3: prompt guidance plus a code guard, see below._
- The explain line sometimes says "הכותרת לא מציינת ..." about features nobody asked for.
  _Round 3: prompt rule plus a post-check, see below._
- Trimming the prompts could bring the per-search cost back toward $0.004; measure quality first.
  _Round 3: done, parse −42% and explain −40% input tokens; see below._

## Round 3 (2026-09-27)

Recording: `fixtures/llm/eval-v3-2026-09-27.json`. Run with
`npx tsx --env-file=.env.local scripts/eval-llm.ts` (same 20 queries, about 40 LLM calls, hard cap
45, 20-30 AliExpress calls). The script prints one table row per query as it runs, then the table
and the summary. `npx tsx scripts/eval-llm.ts --replay <recording>` reprints them for any
recording without API calls.

### What changed before the run (offline, no paid calls)

- **Type gate** (`lib/ranking/rank.ts`, `RANKING_VERSION` 4). Four general rules, each checked
  against every result shown in round 2 (`rank.test.ts` replays the round-2 recording):
  - A product term right after "for", or up to 2 words after "with", names what the listing fits or
    comes with, unless the title already named that product ("Stand for Bluetooth Speaker",
    "Shower Phone Holder with Bluetooth Speaker"; "Night Light With Motion Sensor Light" stays), or
    the noun before "with" was searched for too ("Car Wireless Charger with Phone Holder" for a
    phone holder with wireless charging).
  - A term may not borrow a word from an AliExpress category name pasted into the title
    (`CATEGORY_LABELS`: "... Tools Home Garden Tools" is not a garden tool). A label that opens
    the title is the product's own name ("Home Garden Hose ..." stays).
  - "holder" joins the accessory nouns ("Bike Water Bottle Holder"), and a device noun after the
    term makes it a feature of that device ("Bike Light Power Bank Flashlight"), unless the term
    already names a light ("Headlamp Flashlight", "Bike Light Torch" stay).
  - Result: the 4 round-2 misses (padlock picks, bike bottle holder, bike light power bank, shower
    phone holder with a speaker) are rejected; the other 53 round-2 results and the 22 real cables
    in the product fixture still pass. Side effect on the fixtures: a wall charger "with
    Retractable Cable" is no longer a cable, and a car phone holder with a wireless charger no
    longer counts as a plain "charger".
  - Not done: a category-mismatch rule. The recordings keep only first-level category ids, which do
    not separate the misses (the padlock picks and a real trowel are both in Tools), and the real
    category names are noisy (a USB cable under "Security & Protection"). Round 3 records the
    second-level category name of every product shown (`categories` in each record) to decide this
    with data.
- **Parse** (`PARSE_VERSION` 3): guidance that "גן ילדים", and "לגן"/"בגן" with things a child
  takes there, mean kindergarten (with plants, lighting, furniture or tools "לגן" is a garden),
  and the right spelling "אטום לדליפות". In code, a known misspelling is corrected in labels, and
  when the request says "לגן" or "בגן" about kids (a Hebrew kids word in the request, or a kids
  word in the model's own English) and has no gardening word, garden words are removed from the
  keywords, the product terms and the category hint.
- **Explain** (`EXPLAIN_VERSION` 3): "הכותרת לא מציינת ..." only for a requirement in
  `requirements_he`. A post-check cuts an unrequested caveat off the end of the line, or rejects the
  line when it cannot. On the round-2 lines it cut all 6 caveats (none named a requirement) and
  changed nothing else.
- **Shorter prompts** (`PARSE_VERSION` 4, `EXPLAIN_VERSION` 4), measured with the free
  `countTokens` endpoint (system + schema + input): parse 2,652 → 1,393 tokens, explain (3
  products) 2,147 → 1,286. The output schemas lost their field descriptions: with any `.describe()`,
  zod emits `$defs`/`$ref`/`anyOf`, which cost ~390 tokens per parse call. A reviewer compared the
  prompts rule by rule and restored two rules the code relies on.

### Results

Round 2 replayed with the round-3 script, for a like-for-like comparison.

|                                                   | Round 2 (replayed) | Round 3     |
| ------------------------------------------------- | ------------------ | ----------- |
| Queries with 3 results                            | 18                 | 17          |
| Queries with 0 results                            | 0                  | 3           |
| Explanation lines kept (others fell back to data) | 54 of 57           | 49 of 51    |
| "הכותרת לא מציינת" caveats shown                  | 6                  | 0           |
| Round-2 misses shown again                        | 4                  | 0           |
| Parse: average input / output tokens              | 2,512 / 102        | 1,390 / 106 |
| Explain: average input / output tokens            | 2,070 / 311        | 1,268 / 300 |
| Average cost per search (all 20)                  | $0.00646           | $0.00427    |
| Average cost per search with results              | $0.00664           | $0.00469    |

### Findings

- The type gate, kindergarten and caveat fixes worked: kids-bottle parses as a kids water bottle
  labelled "אטום לדליפות", no round-2 miss came back, and no line carries an unrequested caveat.
- The trim went too far on parse. Three queries that had results in round 2 found none, all
  because of the parse:
  - gift-cook ("מתנה לאבא שאוהב לבשל"): product_terms "cooking gift", "kitchen gift" (a gift is not a
    product type), so 79 of 94 were rejected by the type gate.
  - tech-charger: requirement "supports laptop charging", a description no seller title contains.
  - ho-neck-pillow: requirement "for long flights" (an occasion).
- Fix (`PARSE_VERSION` 5, 1,529 tokens, still −42% against round 2): three rules from round 2 went
  back in their original wording. product_terms never hold gift, occasion or audience words, and a
  request without a product gets the most common fitting type. A requirement is a short phrase as
  sellers title it, never a description. Who it is for, the occasion and a general use ("למשרד",
  "לקמפינג") are not requirements. The two-requirement example went back as well. It needs a paid
  re-run of the three queries (`--only gift-cook,tech-charger,ho-neck-pillow`, 6 LLM calls).
- Explain wording is a little rougher in places ("אלחוטי עם נטענות", a garbled "וזקנין"). The
  post-checks do not catch Hebrew style; watch it in production.
