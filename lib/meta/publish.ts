// Posting an approved product to the Facebook Page and its Instagram account (owner request
// 2026-10-23; every post approved by the owner in /admin/agents) through Meta's Graph API with a
// Page access token (Facebook Login for Business: pages_manage_posts, pages_read_engagement,
// instagram_basic, instagram_content_publish). Off until the owner sets META_PAGE_ID and
// META_PAGE_ACCESS_TOKEN (and META_IG_USER_ID for Instagram) in Vercel; they set them, never in
// chat. The token is never logged or put in an error message. Docs checked 2026-10-23:
// developers.facebook.com/docs/pages-api/posts (POST /{page-id}/feed: message, link) and
// /docs/instagram-platform/content-publishing (POST /{ig-id}/media with a public JPEG image_url and
// caption, then POST /{ig-id}/media_publish with creation_id; 100 posts a 24 h at most).
import { absoluteUrl } from "@/lib/config/site";

export const DEFAULT_GRAPH_VERSION = "v26.0";

export interface MetaConfig {
  pageId: string;
  token: string;
  /** The Instagram professional account linked to the Page; null: no Instagram. */
  igUserId: string | null;
  version: string;
}

/** The Page to post to, or null while META_PAGE_ID or META_PAGE_ACCESS_TOKEN is unset. */
export function metaConfig(source: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  const pageId = source.META_PAGE_ID?.trim();
  const token = source.META_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !token) return null;
  const version = source.META_GRAPH_VERSION?.trim();
  return {
    pageId,
    token,
    igUserId: source.META_IG_USER_ID?.trim() || null,
    version: version && /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION,
  };
}

/** Said in every post (the affiliate disclosure, as beside every buy button on the site). */
export const META_DISCLOSURE = "קישור שותפים: ייתכן שנקבל עמלה מרכישה, בלי עלות נוספת לכם.";

/** The Facebook post: the approved text and the disclosure; the product page is the post's link. */
export function facebookMessage(postHe: string): string {
  return `${postHe.trim()}\n\n${META_DISCLOSURE}`;
}

/** Instagram allows no clickable link in a post: it points to the profile's link instead. */
export const INSTAGRAM_LINK_NOTE = "לפרטים ולקנייה: הקישור בפרופיל שלנו.";

/** Instagram's caption limit. */
export const IG_CAPTION_MAX = 2200;

export function instagramCaption(postHe: string): string {
  const tail = `\n\n${INSTAGRAM_LINK_NOTE}\n${META_DISCLOSURE}`;
  const body = postHe.trim().slice(0, IG_CAPTION_MAX - tail.length);
  return `${body}${tail}`;
}

/** The product page the Facebook post links to (its Open Graph card has the product's photo). */
export function productLink(productId: string): string {
  return absoluteUrl(`/p/${encodeURIComponent(productId)}`);
}

/**
 * The image Instagram fetches (a public JPEG, the only format it takes): the product's own photo
 * when it is a .jpg, else the product page's Open Graph card (always JPEG, 1200x630).
 */
export function instagramImage(productId: string, photoUrl: string | undefined): string {
  if (photoUrl && /^https:\/\/[^?#]+\.jpe?g(?:[?#].*)?$/i.test(photoUrl)) return photoUrl;
  return absoluteUrl(`/p/${encodeURIComponent(productId)}/opengraph-image`);
}

export type MetaResult = { ok: true; id: string } | { ok: false; error: string };

interface GraphAnswer {
  id?: string;
  post_id?: string;
  error?: { message?: string; code?: number; error_subcode?: number };
}

/** One Graph API POST; never throws, and an error never holds the token. */
async function graphPost(
  config: MetaConfig,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: GraphAnswer | null } | { status: 0; body: null; name: string }> {
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${config.version}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${config.token}`,
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as GraphAnswer | null };
  } catch (err) {
    return { status: 0, body: null, name: err instanceof Error ? err.name : "network error" };
  }
}

function failure(
  answer: Awaited<ReturnType<typeof graphPost>>,
  token: string,
): { ok: false; error: string } {
  if (answer.status === 0)
    return { ok: false, error: "name" in answer ? answer.name : "network error" };
  const message = answer.body?.error?.message ?? "no answer";
  // Meta's messages never hold the token, but make sure.
  const safe = message.split(token).join("[token]");
  return { ok: false, error: `Meta ${answer.status}: ${safe}`.slice(0, 300) };
}

/** A link post on the Page: the approved text, linking to our product page. */
export async function publishFacebook(
  config: MetaConfig,
  post: { productId: string; postHe: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaResult> {
  const answer = await graphPost(
    config,
    `${encodeURIComponent(config.pageId)}/feed`,
    { message: facebookMessage(post.postHe), link: productLink(post.productId) },
    fetchImpl,
  );
  const id = answer.body?.id;
  return answer.status === 200 && id ? { ok: true, id } : failure(answer, config.token);
}

/** Meta's code for a container not ready yet (publish again a little later). */
const NOT_READY_SUBCODE = 2207027;

/**
 * An image post on the linked Instagram account: create the container, then publish it, trying
 * the publish again (up to 3 times, `waitMs` apart) while Meta says the media is not ready.
 */
export async function publishInstagram(
  config: MetaConfig,
  post: { productId: string; postHe: string; photoUrl?: string },
  fetchImpl: typeof fetch = fetch,
  waitMs = 3_000,
): Promise<MetaResult> {
  if (!config.igUserId) return { ok: false, error: "META_IG_USER_ID is not set" };
  const ig = encodeURIComponent(config.igUserId);
  const container = await graphPost(
    config,
    `${ig}/media`,
    {
      image_url: instagramImage(post.productId, post.photoUrl),
      caption: instagramCaption(post.postHe),
    },
    fetchImpl,
  );
  const creationId = container.body?.id;
  if (container.status !== 200 || !creationId) return failure(container, config.token);
  for (let attempt = 0; ; attempt++) {
    const published = await graphPost(
      config,
      `${ig}/media_publish`,
      { creation_id: creationId },
      fetchImpl,
    );
    const id = published.body?.id;
    if (published.status === 200 && id) return { ok: true, id };
    const notReady = published.body?.error?.error_subcode === NOT_READY_SUBCODE;
    if (!notReady || attempt >= 2) return failure(published, config.token);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}
