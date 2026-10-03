// Crawlers and scripts never start paid search work (owner request 2026-10-03: AI engines and
// search engines should know the site, never spend money on it). /search and POST /api/search ask
// isBotUserAgent first and serve a crawler only what is already cached (cachedSearchForBot in
// lib/search/server.ts); robots.txt (app/robots.ts) asks them to keep out of /search too, but a
// robots rule is a request, not a guard. Pure, no imports: tested in ./bots.test.ts.
//
// The list is maintained by hand: add a crawler when one shows up in the logs. A person's browser
// never matches (tested with Chrome, Safari, Firefox, Edge, Samsung Internet and the in-app
// browsers of Facebook, Instagram, TikTok, Pinterest and the Naver and Yandex apps), so a name
// that is also an app (Pinterest, Naver, Yandex, Sogou) is listed only as its crawler's name. A
// missing or empty user agent is a script.

/** Named crawlers, fetchers and automation tools, matched anywhere in the user agent. */
const NAMED: readonly string[] = [
  // Search engines (most also say "...bot/", which GENERIC catches).
  "googlebot",
  "googleother",
  "google-inspectiontool",
  "google-extended",
  "google-read-aloud",
  "google-site-verification",
  "storebot-google",
  "adsbot-google",
  "mediapartners-google",
  "apis-google",
  "feedfetcher-google",
  "bingbot",
  "bingpreview",
  "msnbot",
  "adidxbot",
  "yandexbot",
  "yandex.com/bots",
  "baiduspider",
  "duckduckbot",
  "duckassistbot",
  "applebot",
  "petalbot",
  "seznambot",
  "yeti/",
  // AI assistants and their crawlers.
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claudebot",
  "claude-user",
  "claude-searchbot",
  "claude-web",
  "anthropic-ai",
  "perplexitybot",
  "perplexity-user",
  "bytespider",
  "ccbot",
  "amazonbot",
  "cohere-ai",
  "youbot",
  "diffbot",
  "timpibot",
  "imagesiftbot",
  "mistralai-user",
  "meta-externalagent",
  "meta-externalfetcher",
  // Link previews and social fetchers.
  "facebookexternalhit",
  "facebookcatalog",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "pinterestbot",
  "redditbot",
  "skypeuripreview",
  "embedly",
  "quora link preview",
  "vkshare",
  // SEO tools and archives.
  "semrush",
  "ahrefs",
  "mj12bot",
  "dotbot",
  "rogerbot",
  "screaming frog",
  "dataforseo",
  "serpstat",
  "ia_archiver",
  "archive.org_bot",
  // Headless browsers and automation.
  "headlesschrome",
  "chrome-lighthouse",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  "webdriver",
  // HTTP libraries and command-line tools.
  "curl/",
  "wget/",
  "python-requests",
  "python-urllib",
  "httpx",
  "aiohttp",
  "scrapy",
  "libwww-perl",
  "java/",
  "okhttp",
  "go-http-client",
  "node-fetch",
  "axios/",
  "undici",
  "got (",
  "apache-httpclient",
  "postmanruntime",
  "insomnia/",
  "guzzlehttp",
];

/**
 * A word that ends in "bot", "crawler" or "spider" before a version, a separator or the end
 * ("SomethingBot/1.0", "x-bot;"). Phone models that end in "bot" are no crawler (NOT_BOTS).
 */
const BOT_WORD = /[a-z0-9_-]*(?:bot|crawler|spider)(?=[/;)\s+,]|$)/gi;
const NOT_BOTS = new Set(["cubot"]);
/** Other words only crawlers use, and WhatsApp's link preview fetcher ("WhatsApp/2.23.20 A"). */
const OTHER = /crawl|scraper|slurp|^whatsapp\//i;

/** True for a crawler, link preview, automation tool or script; false for a person's browser. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  const lower = ua.toLowerCase();
  if (NAMED.some((name) => lower.includes(name))) return true;
  if (OTHER.test(ua)) return true;
  return (ua.match(BOT_WORD) ?? []).some((word) => !NOT_BOTS.has(word.toLowerCase()));
}
