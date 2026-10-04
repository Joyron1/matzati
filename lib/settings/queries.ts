// Reads of the owner settings (public.site_settings) with the service role. The search reads the
// shop cap once per request through a 5-minute cache under SETTINGS_TAG, which the admin's save
// expires (./admin.ts), and falls back to the default on any failure: a settings hiccup never
// fails a search. Every page reads the public settings (Google Analytics, Search Console, the
// Meta Pixel, the community link) the same way from the root layout and the footer, so pages stay static.
// /admin/settings reads fresh.
import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { DEFAULT_SHOP_CAP_MODE, type ShopCapMode } from "@/lib/ranking/config";
import { serviceClient } from "@/lib/supabase/server";
import {
  COMMUNITY_KEY,
  communityLinkOf,
  communityValueOf,
  DEFAULT_COMMUNITY_LABEL,
  DEFAULT_COMMUNITY_VALUE,
  type CommunityLink,
  type CommunityValue,
} from "./community-link";
import { selectSetting, selectSettings } from "./db";
import {
  extractMeasurementId,
  extractVerificationToken,
  GOOGLE_ANALYTICS_KEY,
  measurementIdOf,
  SEARCH_CONSOLE_KEY,
  siteVerificationOf,
} from "./google";
import { extractPixelId, META_PIXEL_KEY, pixelIdOf } from "./meta";
import { SETTINGS_TAG, SHOP_CAP_KEY, shopCapModeOf, type ShopCapSetting } from "./schema";

/** Seconds a read is reused before the next one reads the table again. */
const REVALIDATE_SECONDS = 300;
/**
 * After a failed read (the table is missing, the database is down), this instance uses the
 * default for this long without trying again, so a search does not wait for a failing read each
 * time and the log gets one line a minute, not one per search.
 */
const FAILURE_PAUSE_MS = 60_000;

function logError(where: string, err: unknown) {
  // Name and message only: never a stored value.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[settings] ${where}: ${text.slice(0, 300)}`);
}

/**
 * The stored shop cap setting. A value this code does not know reads as the default (logged); a
 * failed read throws, so it is never cached.
 */
async function readShopCap(): Promise<ShopCapSetting> {
  const row = await selectSetting(serviceClient(), SHOP_CAP_KEY);
  if (!row) return { mode: DEFAULT_SHOP_CAP_MODE, stored: false, updatedAt: null };
  const mode = shopCapModeOf(row.value);
  if (mode === null) logError("shop cap", new Error("stored value is not a known mode"));
  return { mode: mode ?? DEFAULT_SHOP_CAP_MODE, stored: mode !== null, updatedAt: row.updatedAt };
}

// Errors are thrown inside, so a failure is never cached.
const cachedShopCapMode = unstable_cache(
  async (): Promise<ShopCapMode> => (await readShopCap()).mode,
  ["settings-shop-cap"],
  { revalidate: REVALIDATE_SECONDS, tags: [SETTINGS_TAG] },
);

let failedAt: number | null = null;

/**
 * The shop cap mode the search ranks under (lib/search/server.ts, once per request): the admin's
 * setting, cached 5 minutes, or DEFAULT_SHOP_CAP_MODE when it cannot be read. Never throws.
 */
export async function shopCapMode(): Promise<ShopCapMode> {
  if (failedAt !== null && Date.now() - failedAt < FAILURE_PAUSE_MS) return DEFAULT_SHOP_CAP_MODE;
  try {
    const mode = await cachedShopCapMode();
    failedAt = null;
    return mode;
  } catch (err) {
    failedAt = Date.now();
    logError("shop cap", err);
    return DEFAULT_SHOP_CAP_MODE;
  }
}

/** The setting as /admin/settings shows it, read fresh; null when it cannot be read (logged). */
export async function shopCapSettingForAdmin(): Promise<ShopCapSetting | null> {
  try {
    return await readShopCap();
  } catch (err) {
    logError("admin read", err);
    return null;
  }
}

// Public settings: what every page may show or load.

/** What pages read from the owner settings. Every field is null while unset. */
export interface PublicSettings {
  /** Google Analytics 4 measurement id ("G-…"): the consent-gated loader and the legal texts. */
  measurementId: string | null;
  /** Search Console HTML-tag verification token: <meta name="google-site-verification">. */
  siteVerification: string | null;
  /** Meta Pixel id: the pixel inside ConsentGate "marketing", /go's buy-click event, the texts. */
  metaPixelId: string | null;
  /** The footer's "join our community" button, only while it is switched on. */
  community: CommunityLink | null;
}

export const EMPTY_PUBLIC_SETTINGS: PublicSettings = {
  measurementId: null,
  siteVerification: null,
  metaPixelId: null,
  community: null,
};

const PUBLIC_KEYS = [
  GOOGLE_ANALYTICS_KEY,
  SEARCH_CONSOLE_KEY,
  META_PIXEL_KEY,
  COMMUNITY_KEY,
] as const;

/** One read of the public keys. A stored value this code does not accept reads as unset (logged). */
async function readPublicSettings(): Promise<PublicSettings> {
  const rows = await selectSettings(serviceClient(), PUBLIC_KEYS);
  const value = (key: string) => rows.get(key)?.value;
  const settings: PublicSettings = {
    measurementId: measurementIdOf(value(GOOGLE_ANALYTICS_KEY)),
    siteVerification: siteVerificationOf(value(SEARCH_CONSOLE_KEY)),
    metaPixelId: pixelIdOf(value(META_PIXEL_KEY)),
    community: communityLinkOf(value(COMMUNITY_KEY)),
  };
  // A row that is neither valid nor the owner's "cleared" ({field: null}) was edited by hand.
  const unusable = (key: string, parsed: unknown, field: string) =>
    rows.has(key) && parsed === null && !isCleared(value(key), field);
  if (unusable(GOOGLE_ANALYTICS_KEY, settings.measurementId, "measurementId")) {
    logError("google analytics", new Error("stored value is not a measurement id"));
  }
  if (unusable(SEARCH_CONSOLE_KEY, settings.siteVerification, "verification")) {
    logError("search console", new Error("stored value is not a verification token"));
  }
  if (unusable(META_PIXEL_KEY, settings.metaPixelId, "pixelId")) {
    logError("meta pixel", new Error("stored value is not a pixel id"));
  }
  if (rows.has(COMMUNITY_KEY) && communityValueOf(value(COMMUNITY_KEY)) === null) {
    logError("community", new Error("stored value is not a community setting"));
  }
  return settings;
}

/** Whether a stored value is the owner's "cleared" (the field saved empty). */
function isCleared(value: unknown, field: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[field] === null
  );
}

// Errors are thrown inside, so a failure is never cached.
const cachedPublicSettings = unstable_cache(readPublicSettings, ["settings-public"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [SETTINGS_TAG],
});

let publicFailedAt: number | null = null;

async function storedPublicSettings(): Promise<PublicSettings> {
  if (publicFailedAt !== null && Date.now() - publicFailedAt < FAILURE_PAUSE_MS) {
    return EMPTY_PUBLIC_SETTINGS;
  }
  try {
    const settings = await cachedPublicSettings();
    publicFailedAt = null;
    return settings;
  } catch (err) {
    publicFailedAt = Date.now();
    logError("public read", err);
    return EMPTY_PUBLIC_SETTINGS;
  }
}

/**
 * Local development only: DEV_GOOGLE_ANALYTICS_ID, DEV_GOOGLE_SITE_VERIFICATION, DEV_META_PIXEL_ID
 * and DEV_COMMUNITY_URL (for example in .env.development.local, which `next dev` reloads when it
 * changes) replace the stored values, so the loaders, the meta tag, the texts and the footer
 * button can be tried without writing to the database. Each goes through the same extraction as
 * the admin form; an unusable one is ignored (logged). Ignored unless NODE_ENV is "development",
 * so never on Vercel (production and preview builds run with NODE_ENV "production").
 */
export function withDevOverride(
  settings: PublicSettings,
  env: Record<string, string | undefined> = process.env,
): PublicSettings {
  if (env.NODE_ENV !== "development") return settings;
  const result = { ...settings };
  const ga = env.DEV_GOOGLE_ANALYTICS_ID?.trim();
  if (ga) {
    const found = extractMeasurementId(ga);
    if (found.kind === "found") result.measurementId = found.value;
    else logError("dev override", new Error("DEV_GOOGLE_ANALYTICS_ID is not a measurement id"));
  }
  const gsc = env.DEV_GOOGLE_SITE_VERIFICATION?.trim();
  if (gsc) {
    const found = extractVerificationToken(gsc);
    if (found.kind === "found") result.siteVerification = found.value;
    else logError("dev override", new Error("DEV_GOOGLE_SITE_VERIFICATION is not a token"));
  }
  const pixel = env.DEV_META_PIXEL_ID?.trim();
  if (pixel) {
    const found = extractPixelId(pixel);
    if (found.kind === "found") result.metaPixelId = found.value;
    else logError("dev override", new Error("DEV_META_PIXEL_ID is not a pixel id"));
  }
  const community = env.DEV_COMMUNITY_URL?.trim();
  if (community) {
    const link = communityLinkOf({ url: community, label: DEFAULT_COMMUNITY_LABEL, enabled: true });
    if (link) result.community = link;
    else logError("dev override", new Error("DEV_COMMUNITY_URL is not an https link"));
  }
  return result;
}

/**
 * The public settings for this render: cached 5 minutes under SETTINGS_TAG (the admin's save
 * expires it), shared by generateMetadata, the layout and the footer within one request.
 * EMPTY_PUBLIC_SETTINGS when they cannot be read (logged; the next minute does not read again).
 * Never throws.
 */
export const publicSettings = cache(async (): Promise<PublicSettings> =>
  withDevOverride(await storedPublicSettings()),
);

/** The GA4 measurement id pages load (after consent) and the legal texts describe; null when unset. */
export async function googleAnalyticsId(): Promise<string | null> {
  return (await publicSettings()).measurementId;
}

/** The connections and the community link as /admin/settings shows them, read fresh. */
export interface PublicSettingsForAdmin {
  google: {
    measurementId: string | null;
    siteVerification: string | null;
    /** When either was last saved (ISO), or null. */
    updatedAt: string | null;
  };
  meta: { pixelId: string | null; updatedAt: string | null };
  community: CommunityValue & { updatedAt: string | null };
}

/** Null when the settings cannot be read (logged). */
export async function publicSettingsForAdmin(): Promise<PublicSettingsForAdmin | null> {
  try {
    const rows = await selectSettings(serviceClient(), PUBLIC_KEYS);
    const ga = rows.get(GOOGLE_ANALYTICS_KEY);
    const gsc = rows.get(SEARCH_CONSOLE_KEY);
    const meta = rows.get(META_PIXEL_KEY);
    const community = rows.get(COMMUNITY_KEY);
    const latest = [ga?.updatedAt, gsc?.updatedAt]
      .filter((t): t is string => typeof t === "string")
      .sort()
      .at(-1);
    return {
      google: {
        measurementId: measurementIdOf(ga?.value),
        siteVerification: siteVerificationOf(gsc?.value),
        updatedAt: latest ?? null,
      },
      meta: { pixelId: pixelIdOf(meta?.value), updatedAt: meta?.updatedAt ?? null },
      community: {
        ...(communityValueOf(community?.value) ?? DEFAULT_COMMUNITY_VALUE),
        updatedAt: community?.updatedAt ?? null,
      },
    };
  } catch (err) {
    logError("admin read (public settings)", err);
    return null;
  }
}
