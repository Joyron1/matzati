# WhatsApp bot

The site's search, hot products, coupons and sales calendar, in a WhatsApp chat. Built on the
WhatsApp Business Platform (Cloud API), Graph API v25.0 (`WHATSAPP_GRAPH_VERSION`). Code:
`lib/whatsapp/`, the webhook `app/api/whatsapp/webhook/route.ts`, the tables
`supabase/migrations/20260929120000_whatsapp.sql`, the privacy section `app/privacy/whatsapp.tsx`.

**The bot has no search logic of its own.** It calls the site's `searchForRequest` and
`moreForRequest` (`lib/search/server.ts`), `hotCarouselProducts` (`lib/hot/queries.ts`),
`listPublicCoupons` and `nextSale`. Filters, ranking, the two caches, the explain checks, the daily
LLM budget and every rule in CLAUDE.md §1-§2 are therefore the website's. Do not add a second path.

## What a user gets

| The user                                                    | The bot                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free Hebrew text ("אוזניות לריצה, עמידות למים, עד 100 ש״ח") | A "what we understood / how many passed" message (quoting theirs), then **five photo cards**, each an interactive CTA-URL message: photo, title, price, feedback %, 30-day sales, the "why" line and a **לקנייה באלי אקספרס** button. Then reply buttons (**עוד 5 אפשרויות**, the two other orders) and a list to remove a filter or open another feature. |
| `עוד` or the button                                         | Places 6-10, then 11-15 (the site keeps 15).                                                                                                                                                                                                                                                                                                               |
| A sort button (הכי משתלם / הכי זול / הכי נמכר)              | The same search in that order (a re-rank from the checked pool: no new AliExpress call).                                                                                                                                                                                                                                                                   |
| A "בלי ״X״" row                                             | The same search without that filter chip.                                                                                                                                                                                                                                                                                                                  |
| `מוצרים חמים`                                               | The hot list: an intro (thresholds and machine-translation note) and five photo cards.                                                                                                                                                                                                                                                                     |
| `קופונים`                                                   | The owner's coupons valid now, each code in monospace (long-press to copy), with the owner-coupon note.                                                                                                                                                                                                                                                    |
| `מבצעים`                                                    | The next big sale with a countdown, from the owner's dates and their note.                                                                                                                                                                                                                                                                                 |
| `תפריט` / a greeting                                        | A list message with the four features. `עזרה`: search tips and the affiliate link.                                                                                                                                                                                                                                                                         |
| `עצור`                                                      | Deletes their remembered search. The bot never writes first, so there is nothing to unsubscribe from.                                                                                                                                                                                                                                                      |
| A voice note, photo, sticker...                             | A polite "text only".                                                                                                                                                                                                                                                                                                                                      |

WhatsApp features used: interactive **CTA URL** messages with an image header, **reply buttons**,
**list messages**, **contextual replies** (the summary quotes the user's message), and
**read receipts with the typing indicator**. Not used on purpose: template and marketing messages
(they cost money and need opt-in; see "Not built"), voice or image understanding (the LLM would
have to see things the search rules forbid it to invent), Flows and catalogs.

## Rules that are easy to break

- **Photos are the original JPEG or PNG.** WhatsApp shows only JPEG and PNG (5 MB); the site's
  resized copies (`aliImageUrl`) are WebP and would fail. `cardImage` (`lib/whatsapp/messages.ts`)
  takes the original URL on AliExpress's image host, or sends the card without a photo.
- **Buy links go through `/go`** (`goUrl`: `src=whatsapp` or `whatsapp_hot`, plus `s=` and `pos=`), so
  clicks are logged and stale links regenerated. Never send a raw affiliate link.
- **The affiliate note sits in the footer of every buy card** ("קישור שותפים" and the address of
  `/terms#affiliate`), as CLAUDE.md §1 requires.
- **Meta's limits** are in `LIMITS` and enforced in `messages.test.ts` for every builder (body 1024,
  footer 60, button 20, list rows 10...). Add a builder, add it to the test.
- **Rate limits are per user, not per IP.** Every request reaches us from Meta's servers, so
  `rateLimitHeaders` (`session.ts`) passes `x-forwarded-for: wa:<user hash>` and the site's own
  `checkSearchRate` counts that. The user hash is `sha256("wa:" + wa_id + IP_HASH_SALT)`: the phone
  number is never stored, logged or used as a key.
- **Bot searches are never listed on `/searches`** (`typed: false`).
- **Answer 200 at once, work in `after()`.** A fresh search takes 10-25 s; Meta retries a slow POST
  for up to 36 hours. `whatsapp_seen` makes a redelivered message answer only once.
- **A failing session store must not lose the results** (`remember` in `bot.ts`).
- **The bot is off until all four secrets are set** (404), and the `/privacy` section appears only
  then. Change `app/privacy/whatsapp.tsx` with any change to what the bot stores or sends.

## Setting it up (owner)

1. In Meta for Developers: create a Business app with the WhatsApp product, verify the business,
   add a phone number (production needs a dedicated number), and create a permanent access token
   (a System User token; the temporary one expires in 24 hours).
2. Apply `supabase/migrations/20260929120000_whatsapp.sql` (SQL editor). It creates the two tables
   and the hourly `matzati-whatsapp-retention` job. `pg_cron` was enabled by the retention
   migration.
3. Set the four secrets in Vercel (Production; Preview only if you want to test there) and, for local
   testing, in `.env.local`. Never paste them into chat, tickets or commits:
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any string of 8+
   characters that you choose), `WHATSAPP_APP_SECRET` (the Meta app secret). Redeploy.
4. In the app dashboard (WhatsApp > Configuration) set the callback URL to
   `https://www.matzati-il.com/api/whatsapp/webhook` and the verify token to the one you chose, then
   subscribe to the **messages** field. Meta calls the GET verification, which the route answers.
5. Fill the owner details `/privacy` still shows as "to fill" (`lib/config/legal.ts`), read the new
   WhatsApp section, and bump `LEGAL_UPDATED_AT` on the day the bot goes live.
6. Send the number a message from your own phone. While the app is in development mode only the
   numbers you add as testers can write to it.

Local testing: `npx next dev`, expose it with a tunnel (cloudflared or ngrok) and use it as the
webhook URL with Meta's free test number. The tests need none of this: `npm test`.

## Limits and costs to know

- **AliExpress allows about one call a second for the whole app key** (`ApiCallLimit`; see the
  comments in `lib/search/server.ts`). A search spaces its own calls, but two users searching at the
  same moment, or the website and the bot together, can still collide. Cached searches (14 days) make
  no call, and most hot, coupon and "more" requests are free.
- **`DAILY_SEARCH_CAP` (2000 units of LLM work per Israel day) is shared with the website.** Bot
  traffic can use it up. Raise it, or add a separate bot budget, before promoting the bot.
- **Vercel Hobby:** `maxDuration` is 60 s for the webhook (a fresh search needs up to about 25 s).
  Hobby's terms restrict commercial use; check them before launching a monetized channel.
- **WhatsApp pricing:** replies inside the 24-hour window that a user's message opens are free-form
  service messages. Anything outside it needs a paid, pre-approved template. The bot never sends
  outside the window.
- **Graph API version:** v25.0 is what Meta's docs used on 2026-09-29. When Meta retires it, change
  `WHATSAPP_GRAPH_VERSION`; no code change is expected.

## Not built (decisions for the owner)

- **Alerts** (price drops, new coupons, sale reminders). They need proactive template messages,
  explicit opt-in that is recorded (Communications Law §30A, the newsletter already does this for
  email), a stored phone number (and so a rewrite of the privacy section and retention), and a
  cost per message. Design them separately (CLAUDE.md §10).
- **A "chat on WhatsApp" button on the site** (a `wa.me` link in the footer or on `/search`). One
  small component once the number exists.
- **Product comparison, saved lists, voice and photo search.**
