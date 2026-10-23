// Which files the admin's download route may fetch (app/api/admin/media/route.ts): AliExpress's
// own media hosts over https only, never an open proxy. Pure.

const ALLOWED_HOSTS = [".aliexpress-media.com", ".alicdn.com"];

export function allowedMediaUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return ALLOWED_HOSTS.some((h) => url.hostname.endsWith(h)) ? url : null;
  } catch {
    return null;
  }
}

/** A safe file name: letters, digits, dot, dash and underscore only. */
export function mediaFileName(raw: string | null, url: URL): string {
  const fallback = url.pathname.split("/").pop() || "media";
  return (raw || fallback).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "media";
}
